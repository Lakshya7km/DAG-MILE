import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.warn('⚠️ SUPABASE_URL or SUPABASE_KEY missing in .env. Cloud storage is offline.');
}

const supabase = createClient(supabaseUrl || '', supabaseKey || '');
const BUCKET_NAME = process.env.SUPABASE_BUCKET || 'dataset';

/**
 * Checks if a file already exists in the cloud storage bucket
 */
const checkFileExistsInCloud = async (folderPath, filename) => {
    try {
        const { data, error } = await supabase.storage
            .from(BUCKET_NAME)
            .list(folderPath, { search: filename });

        if (error || !data) return null;

        const match = data.find(f => f.name === filename);
        if (match) {
            const { data: publicData } = supabase.storage
                .from(BUCKET_NAME)
                .getPublicUrl(`${folderPath}/${filename}`);
            return publicData.publicUrl;
        }
        return null;
    } catch (e) {
        return null;
    }
};

/**
 * Uploads a dataset file buffer to Supabase Cloud Storage with automatic deduplication
 */
const uploadDatasetToCloud = async (userId, projectId, filename, fileBuffer, mimeType = 'text/csv') => {
    const sanitizedFilename = filename.replace(/\s+/g, '_');
    const folderPath = `${userId}/${projectId}`;
    const storagePath = `${folderPath}/${sanitizedFilename}`;

    const existingUrl = await checkFileExistsInCloud(folderPath, sanitizedFilename);
    if (existingUrl) {
        console.log(`⚡ [CLOUD DEDUPLICATION] "${sanitizedFilename}" already exists in cloud storage. Skipping re-upload!`);
        return {
            path: storagePath,
            cloudUrl: existingUrl,
            alreadyExisted: true,
        };
    }

    const { data, error } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(storagePath, fileBuffer, {
            contentType: mimeType,
            upsert: false,
        });

    if (error) {
        console.error('❌ Supabase Cloud Storage Upload Error:', error.message);
        throw new Error(`Cloud storage upload failed: ${error.message}`);
    }

    const { data: publicData } = supabase.storage
        .from(BUCKET_NAME)
        .getPublicUrl(storagePath);

    console.log(`☁️ [CLOUD UPLOAD] "${sanitizedFilename}" uploaded to Supabase successfully!`);
    return {
        path: storagePath,
        cloudUrl: publicData.publicUrl,
        alreadyExisted: false,
    };
};

/**
 * Deletes all dataset files under a project folder from Supabase Cloud Storage
 * to immediately free up cloud storage quota.
 */
const deleteProjectFolderFromCloud = async (userId, projectId) => {
    try {
        const folderPath = `${userId}/${projectId}`;
        const { data: files, error: listError } = await supabase.storage
            .from(BUCKET_NAME)
            .list(folderPath);

        if (listError || !files || files.length === 0) {
            return { success: true, deletedCount: 0 };
        }

        const filesToRemove = files.map(f => `${folderPath}/${f.name}`);
        const { error: removeError } = await supabase.storage
            .from(BUCKET_NAME)
            .remove(filesToRemove);

        if (removeError) {
            console.error('❌ Error removing files from Supabase:', removeError.message);
            return { success: false, error: removeError.message };
        }

        console.log(`🧹 [CLOUD PURGE] Removed ${filesToRemove.length} files from Supabase for project ${projectId}. Cloud quota freed!`);
        return { success: true, deletedCount: filesToRemove.length };
    } catch (err) {
        console.error('❌ Error purging cloud storage:', err.message);
        return { success: false, error: err.message };
    }
};

export {
    supabase,
    uploadDatasetToCloud,
    checkFileExistsInCloud,
    deleteProjectFolderFromCloud,
};

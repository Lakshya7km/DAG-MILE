import { uploadDatasetToCloud } from './services/storage.services.js';

async function testUpload() {
    console.log('☁️ Testing upload to Supabase Cloud Storage bucket "dataset"...');

    const sampleCsvData = `id,LotArea,SalePrice,Neighborhood
1,8450,208500,CollgCr
2,9600,181500,Veenker
3,11250,223500,CollgCr`;

    const buffer = Buffer.from(sampleCsvData, 'utf-8');
    const mockUserId = 'user-test-123';
    const mockProjectId = 'project-housing-001';
    const filename = 'housing_sample.csv';

    try {
        const result = await uploadDatasetToCloud(
            mockUserId,
            mockProjectId,
            filename,
            buffer,
            'text/csv'
        );

        console.log('\n🎉 UPLOAD SUCCESSFUL!');
        console.log('📁 Cloud Path: ', result.path);
        console.log('🔗 Public URL:  ', result.cloudUrl);
        console.log('\nYou can copy & paste the Public URL into your browser to download the file directly!');
    } catch (err) {
        console.error('\n❌ Test upload failed:', err.message);
        console.log('👉 Make sure the bucket "datasets" exists in your Supabase dashboard and is set to Public!');
    }
}

testUpload();

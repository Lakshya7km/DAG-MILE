const PYTHON_ML_URL = process.env.PYTHON_ML_URL || 'http://127.0.0.1:8000';

/**
 * Parses CSV text into array of objects and headers
 */
function parseCsv(csvText, maxRows = Infinity) {
    const lines = csvText.split(/\r?\n/).filter(line => line.trim() !== '');
    if (lines.length === 0) return { headers: [], rows: [] };

    // Basic CSV line parser handling quotes
    const parseLine = (text) => {
        const result = [];
        let cur = '';
        let inQuotes = false;
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                result.push(cur.trim());
                cur = '';
            } else {
                cur += char;
            }
        }
        result.push(cur.trim());
        return result;
    };

    const headers = parseLine(lines[0]);
    const rowLines = lines.slice(1, maxRows + 1);
    const rows = rowLines.map(line => parseLine(line));

    return { headers, rows };
}

/**
 * Live Dataset Preview (First 10 rows)
 */
const previewDataset = async (req, res) => {
    const { sessionId, filename } = req.params;

    try {
        const upstream = await fetch(`${PYTHON_ML_URL}/api/download/${encodeURIComponent(sessionId)}/${encodeURIComponent(filename)}`);
        if (!upstream.ok) {
            return res.status(upstream.status).json({
                message: "Not Found",
                error: `Could not fetch dataset '${filename}' for preview.`
            });
        }

        const csvText = await upstream.text();
        const { headers, rows } = parseCsv(csvText, 10);

        return res.status(200).json({
            success: true,
            filename,
            columns: headers,
            rows,
            previewRowCount: rows.length,
        });
    } catch (err) {
        console.error('Error generating preview:', err.message);
        const isOffline = err.message.includes('fetch failed') || err.message.includes('ECONNREFUSED');
        return res.status(isOffline ? 502 : 500).json({
            message: isOffline ? "Bad Gateway" : "Internal Server Error",
            error: isOffline ? "Python ML engine is unavailable. Please ensure Python backend is running on port 8000." : err.message
        });
    }
};

/**
 * Multi-Format Dataset Export (JSON / CSV)
 */
const exportDatasetMultiFormat = async (req, res) => {
    const { sessionId, filename } = req.params;
    const format = (req.query.format || 'csv').toLowerCase();

    try {
        const upstream = await fetch(`${PYTHON_ML_URL}/api/download/${encodeURIComponent(sessionId)}/${encodeURIComponent(filename)}`);
        if (!upstream.ok) {
            return res.status(upstream.status).json({
                message: "Not Found",
                error: `Could not fetch dataset '${filename}' for export.`
            });
        }

        const baseName = filename.replace(/\.[^/.]+$/, "");

        if (format === 'json') {
            const csvText = await upstream.text();
            const { headers, rows } = parseCsv(csvText);

            const jsonArray = rows.map(row => {
                const obj = {};
                headers.forEach((h, i) => {
                    const val = row[i];
                    // Auto-convert numeric and boolean strings
                    if (val === undefined || val === '') obj[h] = null;
                    else if (!isNaN(Number(val))) obj[h] = Number(val);
                    else if (val.toLowerCase() === 'true') obj[h] = true;
                    else if (val.toLowerCase() === 'false') obj[h] = false;
                    else obj[h] = val;
                });
                return obj;
            });

            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="${baseName}_cleaned.json"`);
            return res.send(JSON.stringify(jsonArray, null, 2));
        }

        // Default: CSV Stream
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${baseName}_cleaned.csv"`);
        const csvText = await upstream.text();
        return res.send(csvText);

    } catch (err) {
        console.error('Error exporting dataset:', err.message);
        const isOffline = err.message.includes('fetch failed') || err.message.includes('ECONNREFUSED');
        return res.status(isOffline ? 502 : 500).json({
            message: isOffline ? "Bad Gateway" : "Internal Server Error",
            error: isOffline ? "Python ML engine is unavailable. Please ensure Python backend is running on port 8000." : err.message
        });
    }
};

export {
    previewDataset,
    exportDatasetMultiFormat,
};

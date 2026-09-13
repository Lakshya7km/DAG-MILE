import pg, { Client } from 'pg'
import dotenv from 'dotenv'


dotenv.config();


const { Pool } = pg;

//Pool a set of reusable connection dont open /close per request
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false//req for neon cloud ssl
    }
})



//test the connecction


pool.connect((err, client, release) => {
    if (err) {
        console.error('❌ Database connection failed:', err.message);
    } else {
        console.log('✅ Connected to Neon PostgreSQL!');
        release();
    }
})


export default pool;
import pool from "./config/db.js";


const testDatabase = async()=>{
    try{
        const result = await pool.query("SELECT NOW()");
        console.log("DATABASE Connection:",result.rows[0]);
    } catch (error) {
    console.error("Database connection failed:", error);
  } finally {
    await pool.end();
  }
}

testDatabase()
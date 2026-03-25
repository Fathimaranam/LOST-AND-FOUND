const multer = require("multer");
const path = require("path");

const storage = multer.diskStorage({
    destination: "./uploads/",
    filename: function (req, file, cb) {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage });
const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

const db = mysql.createConnection({
    host: "localhost",
    user: "root",
    password: "0604",
    database: "lost_found"
});

db.connect(err => {
    if (err) {
        console.error("Database connection failed:", err);
        return;
    }
    console.log("Connected to MySQL");
});

app.get("/", (req, res) => {
    res.send("Backend is running!");
});


// ================= LOGIN ROUTE =================
app.post("/login", (req, res) => {
    const { email, password, role_id } = req.body;

    db.query(
        "SELECT USER_ID, NAME, EMAIL, ROLE_ID FROM USER WHERE EMAIL = ? AND PASSWORD = ? AND ROLE_ID = ?",
        [email, password, role_id],
        (err, result) => {
            if (err) {
                console.error(err);
                return res.status(500).json({ error: "Database error" });
            }

            if (result.length === 0) {
                return res.status(401).json({ error: "Invalid credentials" });
            }

            res.json(result[0]);
        }
    );
});


// ================= USERS =================
app.get("/users", (req, res) => {
    db.query("SELECT USER_ID, NAME, EMAIL, ROLE_ID FROM USER", (err, result) => {
        if (err) {
            console.error(err);
            res.status(500).send("Error fetching users");
        } else {
            res.json(result);
        }
    });
});


// ================= ITEMS =================
app.get("/items", (req, res) => {
    db.query("SELECT * FROM FOUND_ITEM", (err, result) => {
        if (err) {
            console.error(err);
            res.status(500).send("Error fetching items");
        } else {
            res.json(result);
        }
    });
});

app.post("/add-item", upload.single("photo"), (req, res) => {

    const { item_name, user_id, location_id } = req.body;
    const photo = req.file ? req.file.filename : null;

    db.query(
        "INSERT INTO FOUND_ITEM (ITEM_NAME, FOUND_DATE, STATUS, USER_ID, LOCATION_ID, PHOTO) VALUES (?, CURDATE(), 'Found', ?, ?, ?)",
        [item_name, user_id, location_id, photo],
        (err, result) => {
            if (err) {
                console.error(err);
                return res.status(500).send("Error adding item");
            }

            res.send("Item uploaded successfully");
        }
    );
});

// ================= CLAIMS =================
app.post("/submit-claim", (req, res) => {
    const { user_id, item_id, proof } = req.body;

    db.query(
        "INSERT INTO CLAIM (CLAIM_DATE, CLAIM_STATUS, PROOF_DESCRIPTION, ITEM_ID, USER_ID) VALUES (CURDATE(), 'Pending', ?, ?, ?)",
        [proof, item_id, user_id],
        (err, result) => {
            if (err) {
                console.error(err);
                res.status(500).send("Error submitting claim");
            } else {
                res.send("Claim submitted successfully");
            }
        }
    );
});

app.get("/claims", (req, res) => {
    db.query(
        `SELECT 
            CLAIM.CLAIM_ID,
            CLAIM.CLAIM_DATE,
            CLAIM.CLAIM_STATUS,
            CLAIM.PROOF_DESCRIPTION,
            FOUND_ITEM.ITEM_NAME,
            USER.NAME AS USER_NAME
         FROM CLAIM
         JOIN FOUND_ITEM ON CLAIM.ITEM_ID = FOUND_ITEM.ITEM_ID
         JOIN USER ON CLAIM.USER_ID = USER.USER_ID`,
        (err, result) => {
            if (err) {
                console.error(err);
                res.status(500).send("Error fetching claims");
            } else {
                res.json(result);
            }
        }
    );
});


// ================= ADMIN ONLY CLAIM UPDATE =================
app.put("/update-claim-status", (req, res) => {
    const { claim_id, status, role_id } = req.body;

    // Only allow admin (role_id = 2)
    if (role_id != 2) {
        return res.status(403).send("Only admin can update claim status");
    }

    db.query(
        "UPDATE CLAIM SET CLAIM_STATUS = ? WHERE CLAIM_ID = ?",
        [status, claim_id],
        (err, result) => {
            if (err) {
                console.error(err);
                res.status(500).send("Error updating claim");
            } else {
                res.send("Claim status updated");
            }
        }
    );
});


// ================= START SERVER =================
app.listen(3000, () => {
    console.log("Server running on port 3000");
});

// ================= REGISTER =================
app.post("/register", (req, res) => {

    let { name, email, phone, password } = req.body;

    if (!name || !email || !phone || !password) {
        return res.status(400).json({ error: "All fields are required" });
    }

    // Convert email to lowercase
    email = email.toLowerCase();

    // ✅ Allow only TKMCE email
    if (!email.endsWith("@tkmce.ac.in")) {
        return res.status(400).json({
            error: "Only TKMCE college email allowed"
        });
    }

    // ✅ Check if email already exists
    db.query(
        "SELECT * FROM USER WHERE EMAIL = ?",
        [email],
        (err, result) => {

            if (err) {
                console.error(err);
                return res.status(500).json({ error: "Database error" });
            }

            if (result.length > 0) {
                return res.status(400).json({
                    error: "Email already registered"
                });
            }

            // ✅ Insert new student
            db.query(
                "INSERT INTO USER (NAME, EMAIL, PHONE, PASSWORD, ROLE_ID) VALUES (?, ?, ?, ?, 1)",
                [name, email, phone, password],
                (err, result) => {

                    if (err) {
                        console.error(err);
                        return res.status(500).json({ error: "Registration failed" });
                    }

                    res.json({ message: "User registered successfully" });
                }
            );
        }
    );
});
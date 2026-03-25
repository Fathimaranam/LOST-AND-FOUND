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
app.use("/uploads", express.static("uploads"));

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
    
    // Create NOTIFICATION table if it doesn't exist
    const createTableQuery = `
        CREATE TABLE IF NOT EXISTS NOTIFICATION (
            NOTIFICATION_ID INT AUTO_INCREMENT PRIMARY KEY,
            USER_ID INT NOT NULL,
            MESSAGE VARCHAR(255) NOT NULL,
            CLAIM_ID INT,
            IS_READ BOOLEAN DEFAULT 0,
            CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (USER_ID) REFERENCES USER(USER_ID) ON DELETE CASCADE,
            FOREIGN KEY (CLAIM_ID) REFERENCES CLAIM(CLAIM_ID) ON DELETE CASCADE,
            KEY idx_user_notifications (USER_ID, IS_READ),
            KEY idx_created_at (CREATED_AT)
        )
    `;
    
    db.query(createTableQuery, (err) => {
        if (err) {
            console.error("Error creating NOTIFICATION table:", err);
        } else {
            console.log("NOTIFICATION table ready");
        }
    });

    // Add DESCRIPTION column to FOUND_ITEM if it doesn't exist
    const addDescColumnQuery = `
        ALTER TABLE FOUND_ITEM 
        ADD COLUMN DESCRIPTION TEXT
    `;
    
    db.query(addDescColumnQuery, (err) => {
        if (err && err.code !== 'ER_DUP_FIELDNAME') {
            console.error("Error adding DESCRIPTION column:", err);
        } else if (!err) {
            console.log("DESCRIPTION column added");
        } else {
            console.log("DESCRIPTION column already exists");
        }
    });
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
    // Only show items that are still found / not claimed yet
    db.query("SELECT ITEM_ID, ITEM_NAME, FOUND_DATE, STATUS, USER_ID, LOCATION_TEXT, PHOTO, DESCRIPTION FROM FOUND_ITEM WHERE STATUS = 'Found'", (err, result) => {
        if (err) {
            console.error("Error fetching items:", err);
            res.status(500).send("Error fetching items");
        } else {
            console.log("Items fetched:", result.length, "items");
            res.json(result);
        }
    });
});

app.delete("/delete-item/:item_id", (req, res) => {
    const role_id = req.body.role_id;
    const item_id = req.params.item_id;

    console.log("Delete request - item_id:", item_id, "role_id:", role_id);

    if (role_id != 2) {
        console.log("Not admin, role_id:", role_id);
        return res.status(403).send("Only admin can delete items");
    }

    db.query("DELETE FROM CLAIM WHERE ITEM_ID = ?", [item_id], (err) => {
        if (err) {
            console.error("Error deleting claims:", err);
            return res.status(500).send("Error deleting item claims");
        }

        db.query("DELETE FROM FOUND_ITEM WHERE ITEM_ID = ?", [item_id], (err2) => {
            if (err2) {
                console.error("Error deleting item:", err2);
                return res.status(500).send("Error deleting item");
            }
            console.log("Item deleted successfully:", item_id);
            res.send("Item deleted successfully");
        });
    });
});

app.post("/add-item", upload.single("photo"), (req, res) => {

    console.log("Raw req.body:", req.body);
    console.log("Raw req.file:", req.file);

    const { item_name, user_id, location, description } = req.body;
    const photo = req.file ? req.file.filename : null;

    console.log("Parsed data - item_name:", item_name, "user_id:", user_id, "location:", location, "description:", description, "photo:", photo);

    if (!item_name || !user_id || !location || !description) {
        console.log("Missing required fields");
        return res.status(400).send("Missing required fields: item_name, user_id, location, description");
    }

    db.query(
        "INSERT INTO FOUND_ITEM (ITEM_NAME, FOUND_DATE, STATUS, USER_ID, LOCATION_TEXT, PHOTO, DESCRIPTION) VALUES (?, CURDATE(), 'Found', ?, ?, ?, ?)",
        [item_name, user_id, location, photo, description || ""],
        (err, result) => {
            if (err) {
                console.error("Error adding item:", err);
                return res.status(500).send("Error adding item");
            }

            console.log("Item added successfully with ID:", result.insertId);
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

    // ✅ Only admin allowed
    if (role_id != 2) {
        return res.status(403).send("Only admin can update claim status");
    }

    // ✅ Step 1: Update claim status
    db.query(
        "UPDATE CLAIM SET CLAIM_STATUS = ? WHERE CLAIM_ID = ?",
        [status, claim_id],
        (err, result) => {

            if (err) {
                console.error(err);
                return res.status(500).send("Error updating claim");
            }

            // ✅ Step 2: If Approved → remove item (mark as Claimed)
            if (status === "Approved") {

                // First, get the USER_ID from the claim
                db.query(
                    "SELECT USER_ID FROM CLAIM WHERE CLAIM_ID = ?",
                    [claim_id],
                    (err, claimData) => {
                        if (err || claimData.length === 0) {
                            console.error(err);
                            return res.status(500).send("Error getting claim data");
                        }

                        const user_id = claimData[0].USER_ID;

                        // Create notification for the user
                        db.query(
                            "INSERT INTO NOTIFICATION (USER_ID, MESSAGE, CLAIM_ID, IS_READ, CREATED_AT) VALUES (?, ?, ?, 0, NOW())",
                            [user_id, "Your claim request has been approved!", claim_id],
                            (errNotif) => {
                                if (errNotif) {
                                    console.error("Notification insert error:", errNotif);
                                } else {
                                    console.log("Notification created for user:", user_id);
                                }
                            }
                        );

                        // Update item status
                        db.query(
                            `UPDATE FOUND_ITEM 
                             SET STATUS = 'Claimed' 
                             WHERE ITEM_ID = (
                                SELECT ITEM_ID FROM CLAIM WHERE CLAIM_ID = ?
                             )`,
                            [claim_id],
                            (err2) => {

                                if (err2) {
                                    console.error(err2);
                                    return res.status(500).send("Error updating item");
                                }

                                return res.send("Claim approved and item removed");
                            }
                        );
                    }
                );

            } else {
                // If rejected
                res.send("Claim status updated");
            }
        }
    );
});

// ================= NOTIFICATIONS =================
app.get("/notifications/:user_id", (req, res) => {
    const user_id = req.params.user_id;

    db.query(
        "SELECT * FROM NOTIFICATION WHERE USER_ID = ? ORDER BY CREATED_AT DESC LIMIT 10",
        [user_id],
        (err, result) => {
            if (err) {
                console.error(err);
                return res.status(500).send("Error fetching notifications");
            }
            res.json(result);
        }
    );
});

app.get("/notifications-count/:user_id", (req, res) => {
    const user_id = req.params.user_id;

    db.query(
        "SELECT COUNT(*) as unread_count FROM NOTIFICATION WHERE USER_ID = ? AND IS_READ = 0",
        [user_id],
        (err, result) => {
            if (err) {
                console.error(err);
                return res.status(500).send("Error fetching notification count");
            }
            res.json(result[0]);
        }
    );
});

app.put("/mark-notification-read/:notification_id", (req, res) => {
    const notification_id = req.params.notification_id;

    db.query(
        "UPDATE NOTIFICATION SET IS_READ = 1 WHERE NOTIFICATION_ID = ?",
        [notification_id],
        (err) => {
            if (err) {
                console.error(err);
                return res.status(500).send("Error marking notification as read");
            }
            res.send("Notification marked as read");
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
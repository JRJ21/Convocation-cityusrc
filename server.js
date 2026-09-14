const express = require("express");
const mysql = require("mysql2");
const session = require("express-session");
const ExcelJS = require("exceljs");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { rateLimit } = require("express-rate-limit");

require("dotenv").config();

const app = express();

/* =========================================
   MIDDLEWARE
========================================= */

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
    session({
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: false,

        cookie: {
            httpOnly: true,
            sameSite: "lax",
            secure: process.env.NODE_ENV === "production",
            maxAge: 1000 * 60 * 60 * 4
        }
    })
);

app.use(
    express.static(
        path.join(__dirname, "public")
    )
);

/* =========================================
   TRACER STUDY UPLOAD
========================================= */

const tracerUploadDirectory =
    path.join(
        __dirname,
        "private_uploads",
        "tracer"
    );

if (!fs.existsSync(tracerUploadDirectory)) {
    fs.mkdirSync(
        tracerUploadDirectory,
        { recursive: true }
    );
}

const tracerStorage =
    multer.diskStorage({

        destination: function (req, file, cb) {
            cb(null, tracerUploadDirectory);
        },

        filename: function (req, file, cb) {

            const extension =
                path.extname(file.originalname)
                    .toLowerCase();

            const uniqueName =
                "tracer-" +
                Date.now() +
                "-" +
                Math.round(Math.random() * 1E9) +
                extension;

            cb(null, uniqueName);
        }
    });


const tracerUpload =
    multer({

        storage: tracerStorage,

        limits: {
            fileSize: 5 * 1024 * 1024
        },

        fileFilter: function (req, file, cb) {

            const allowedTypes = [
                "image/jpeg",
                "image/png",
                "application/pdf"
            ];

            if (allowedTypes.includes(file.mimetype)) {
                cb(null, true);
            } else {
                cb(
                    new Error(
                        "Only JPG, PNG and PDF files are allowed."
                    )
                );
            }
        }
    });

/* =========================================
   MYSQL
========================================= */

const db = mysql.createConnection({
    host: "localhost",
    user: "root",
    password: process.env.DB_PASSWORD,
    database: "convocation"
});

db.connect((error) => {
    if (error) {
        console.error("❌ MySQL connection failed:");
        console.error(error.message);
        return;
    }

    console.log("✅ Connected to MySQL!");
});

/* =========================================
   PROGRAMME → FACULTY MAPPING
========================================= */

function getFacultyFromProgramme(programme) {

    if (!programme) {
        return "";
    }

    const programmeCode =
        String(programme)
            .trim()
            .split(" - ")[0]
            .toUpperCase();

    const facultyMap = {

        DOSH:
            "Faculty of Allied Health Sciences",

        DIM:
            "Faculty of Business and Management",

        DECE:
            "Faculty of Education and Liberal Studies",

        MED:
            "City Graduate School",

        BBA:
            "Faculty of Business and Management",

        BECE:
            "Faculty of Education and Liberal Studies"
    };

    return facultyMap[programmeCode] || "";
}

/* =========================================
   REGISTRATION
========================================= */

app.post(
    "/api/register",

    tracerUpload.single("tracerProof"),

    (req, res) => {

        const {
            fullName,
            email,
            phone,
            studentId,
            programme,
            attendance,
            guests,
            specialNeeds,
            feedback
        } = req.body;


        if (!req.file) {
            return res.status(400).json({
                message:
                    "Tracer Study proof is required."
            });
        }


        if (
            !fullName ||
            !email ||
            !studentId ||
            !programme ||
            !attendance
        ) {

            fs.unlink(req.file.path, () => {});

            return res.status(400).json({
                message:
                    "Please complete all required fields."
            });
        }

/*=========================================
    VALIDATE PROGRAMME, ATTENDANCE, SPECIAL FACILITIES
=========================================*/
const allowedProgrammes = [
    "DOSH - Diploma in Occupational Safety and Health",
    "DIM - Diploma in Management",
    "DECE - Diploma in Early Childhood Education",
    "MED - Master of Education",
    "BBA - Bachelor of Business Administration (Honours)",
    "BECE - Bachelor of Education (Early Childhood Education) Honours"
];

const cleanEmail = String(email).trim();

const emailPattern =
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

if (
    !emailPattern.test(cleanEmail) ||
    cleanEmail.length > 150
) {
    fs.unlink(req.file.path, () => {});

    return res.status(400).json({
        message:
            "Please enter a valid email address."
    });
}

if (!allowedProgrammes.includes(programme)) {
    fs.unlink(req.file.path, () => {});

    return res.status(400).json({
        message: "Invalid programme selected."
    });
}


const allowedAttendance = [
    "Attend",
    "Not Attend"
];

if (!allowedAttendance.includes(attendance)) {
    fs.unlink(req.file.path, () => {});

    return res.status(400).json({
        message: "Invalid attendance option."
    });
}


const allowedSpecialFacilities = [
    "Yes",
    "No"
];

if (
    specialNeeds &&
    !allowedSpecialFacilities.includes(specialNeeds)
) {
    fs.unlink(req.file.path, () => {});

    return res.status(400).json({
        message: "Invalid special facilities option."
    });
}


        const guestNumber =
            Number(guests) || 0;


        if (
            guestNumber < 0 ||
            guestNumber > 2
        ) {

            fs.unlink(req.file.path, () => {});

            return res.status(400).json({
                message:
                    "Maximum number of guests is 2."
            });
        }


const faculty =
    getFacultyFromProgramme(programme);

const sql = `
    INSERT INTO registrations
    (
        full_name,
        email,
        phone,
        student_id,
        programme,
        faculty,
        attendance,
        guests,
        special_facilities,
        comments,
        tracer_proof_path,
        tracer_proof_name,
        tracer_status,
        tracer_uploaded_at
    )

    VALUES
    (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
`;

        const values = [

            fullName,
            cleanEmail,
            phone,
            studentId,
            programme,
            faculty,
            attendance,
            guestNumber,
            specialNeeds || "No",
            feedback || "",

            req.file.filename,
            req.file.originalname,
            "Submitted"
        ];


        db.query(
            sql,
            values,
            (error, result) => {

                if (error) {

                    console.error(
                        "Registration error:",
                        error
                    );

                    fs.unlink(
                        req.file.path,
                        () => {}
                    );


                    if (
                        error.code ===
                        "ER_DUP_ENTRY"
                    ) {

                        return res
                            .status(409)
                            .json({
                                message:
                                    "This Student ID has already registered."
                            });
                    }


                    return res
                        .status(500)
                        .json({
                            message:
                                "Unable to complete registration."
                        });
                }


                res.status(201).json({

                    message:
                        "Registration submitted successfully.",

                    id:
                        result.insertId,

                    tracerStatus:
                        "Submitted"
                });
            }
        );
    }
);

const adminloginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,

    limit: 5,

    standardHeaders: "draft-8",
    legacyHeaders: false,

    message: {
        message:
            "Too many login attempts. Please wait 15 minutes and try again."
    }
});

const bursaryloginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,

    limit: 5,

    standardHeaders: "draft-8",
    legacyHeaders: false,

    message: {
        message:
            "Too many login attempts. Please wait 15 minutes and try again."
    }
});

/* =========================================
   ADMIN LOGIN
========================================= */

app.post("/api/admin/login", adminloginLimiter, (req, res) => {

    const { username, password } = req.body;

    if (
        username === process.env.ADMIN_USERNAME &&
        password === process.env.ADMIN_PASSWORD
    ) {

        req.session.admin = true;

        return res.json({
            message: "Login successful."
        });
    }

    res.status(401).json({
        message: "Invalid username or password."
    });
});

/* =========================================
   ADMIN LOGOUT
========================================= */

app.post("/api/admin/logout", (req, res) => {

    req.session.destroy((error) => {

        if (error) {
            return res.status(500).json({
                message: "Unable to log out."
            });
        }

        res.clearCookie("connect.sid");

        res.json({
            message: "Logged out."
        });
    });
});

/* =========================================
   CHECK ADMIN LOGIN
========================================= */

app.get("/api/admin/session", (req, res) => {

    res.json({
        loggedIn: req.session.admin === true
    });
});

/* =========================================
   ADMIN AUTHENTICATION
========================================= */

function requireAdmin(req, res, next) {

    if (req.session.admin === true) {
        return next();
    }

    return res.status(401).json({
        message: "Admin login required."
    });
}


/* =========================================
   ADMIN VERIFY / REJECT TRACER PROOF
========================================= */
app.get(
    "/api/admin/tracer-proof/:id",
    requireAdmin,
    (req, res) => {

        const id = Number(req.params.id);

        db.query(
            `
            SELECT tracer_proof_path
            FROM registrations
            WHERE id = ?
            LIMIT 1
            `,
            [id],
            (error, results) => {

                if (error) {
                    return res.status(500).json({
                        message: "Unable to retrieve proof."
                    });
                }

                if (
                    results.length === 0 ||
                    !results[0].tracer_proof_path
                ) {
                    return res.status(404).json({
                        message: "Proof not found."
                    });
                }

                const safeFilename =
                    path.basename(
                        results[0].tracer_proof_path
                    );

                const filePath =
                    path.join(
                        tracerUploadDirectory,
                        safeFilename
                    );

                if (!fs.existsSync(filePath)) {
                    return res.status(404).json({
                        message: "Proof file is missing."
                    });
                }

                res.sendFile(filePath);
            }
        );
    }
);

app.patch(
    "/api/admin/registrations/:id/tracer-status",
    requireAdmin,
    (req, res) => {

        const id = Number(req.params.id);
        const { status } = req.body;

        const allowedStatuses = [
            "Verified",
            "Rejected"
        ];

        if (!allowedStatuses.includes(status)) {
            return res.status(400).json({
                message: "Invalid tracer status."
            });
        }

        db.query(
            `
            UPDATE registrations
            SET tracer_status = ?
            WHERE id = ?
            `,
            [status, id],
            (error, result) => {

                if (error) {
                    return res.status(500).json({
                        message:
                            "Unable to update tracer status."
                    });
                }

                if (result.affectedRows === 0) {
                    return res.status(404).json({
                        message:
                            "Registration not found."
                    });
                }

                res.json({
                    message:
                        `Tracer Study marked as ${status}.`
                });
            }
        );
    }
);

/* =========================================
   ADMIN REGISTRATION LIST
   Only return information required by Admin
========================================= */

app.get(
    "/api/admin/registrations",
    requireAdmin,
    (req, res) => {

        const sql = `
            SELECT
                id,
                full_name,
                email,
                phone,
                student_id,
                programme,
                faculty,
                attendance,
                guests,
                special_facilities,
                comments,
                registered_at,

                tracer_status,
                tracer_uploaded_at,
                tracer_proof_path,
                tracer_proof_name,

                outstanding_status,
                outstanding_updated_at,

                payment_status,
                payment_method

            FROM registrations
            ORDER BY registered_at DESC
        `;

        db.query(
            sql,
            (error, results) => {

                if (error) {
                    console.error(
                        "Admin registration list error:",
                        error
                    );

                    return res.status(500).json({
                        message:
                            "Unable to retrieve registrations."
                    });
                }

                res.json(results);
            }
        );
    }
);
/* =========================================
   STUDENT REGISTRATION STATUS CHECK
========================================= */

app.post(
    "/api/student/check-registration",
    (req, res) => {

        const {
            student_id,
            email
        } = req.body;

        if (!student_id || !email) {
            return res.status(400).json({
                message:
                    "Please enter your Student ID and registered email address."
            });
        }

        const sql = `
            SELECT

                full_name,
                student_id,
                email,
                phone,
                programme,
                faculty,
                attendance,
                guests,
                special_facilities,
                comments,

                tracer_status,
                tracer_uploaded_at,

                outstanding_status,
                outstanding_updated_at,

                payment_status,
                payment_method,
                payment_uploaded_at,
                payment_verified_at,
                payment_remark,

                registered_at

            FROM registrations

            WHERE student_id = ?
            AND LOWER(email) = LOWER(?)

            LIMIT 1
        `;

        db.query(
            sql,
            [
                student_id.trim(),
                email.trim()
            ],
            (error, results) => {

                if (error) {

                    console.error(
                        "Registration status error:",
                        error
                    );

                    return res.status(500).json({
                        message:
                            "Unable to retrieve registration details."
                    });
                }

                if (results.length === 0) {

                    return res.status(404).json({
                        message:
                            "No registration record was found. Please check your Student ID and registered email address."
                    });
                }

                res.json(results[0]);
            }
        );
    }
);

/* =========================================
   ADMIN EDIT REGISTRATION
========================================= */

app.patch(
    "/api/admin/registrations/:id",
    requireAdmin,
    (req, res) => {

        const id = Number(req.params.id);

        const {
            full_name,
            email,
            phone,
            programme,
            attendance,
            guests,
            special_facilities,
            comments
        } = req.body;

        if (
            !Number.isInteger(id) ||
            id <= 0
        ) {
            return res.status(400).json({
                message: "Invalid registration ID."
            });
        }

        if (
            !full_name ||
            !email ||
            !programme ||
            !attendance
        ) {
            return res.status(400).json({
                message: "Please complete all required fields."
            });
        }

        const allowedProgrammes = [
            "DOSH - Diploma in Occupational Safety and Health",
            "DIM - Diploma in Management",
            "DECE - Diploma in Early Childhood Education",
            "MED - Master of Education",
            "BBA - Bachelor of Business Administration (Honours)",
            "BECE - Bachelor of Education (Early Childhood Education) Honours"
        ];

        if (!allowedProgrammes.includes(programme)) {
            return res.status(400).json({
                message: "Invalid programme selected."
            });
        }

        const allowedAttendance = [
            "Attend",
            "Not Attend"
        ];

        if (
            !allowedAttendance.includes(attendance)
        ) {
            return res.status(400).json({
                message: "Invalid attendance status."
            });
        }

        const guestNumber = Number(guests);

        if (
            !Number.isInteger(guestNumber) ||
            guestNumber < 0 ||
            guestNumber > 2
        ) {
            return res.status(400).json({
                message:
                    "Guest count must be between 0 and 2."
            });
        }

        const allowedFacilities = [
            "Yes",
            "No"
        ];

        if (
            !allowedFacilities.includes(
                special_facilities
            )
        ) {
            return res.status(400).json({
                message:
                    "Invalid Special Facilities value."
            });
        }

        const cleanEmail =
            String(email).trim();

        if (
            !cleanEmail.includes("@") ||
            cleanEmail.length > 150
        ) {
            return res.status(400).json({
                message:
                    "Please enter a valid email address."
            });
        }

        const faculty = getFacultyFromProgramme(programme);

        const sql = `
            UPDATE registrations
            SET
                full_name = ?,
                email = ?,
                phone = ?,
                programme = ?,
                faculty = ?,
                attendance = ?,
                guests = ?,
                special_facilities = ?,
                comments = ?
            WHERE id = ?
        `;
        
        const values = [
            String(full_name).trim(),
            cleanEmail,
            phone ? String(phone).trim() : "",
            String(programme).trim(),
            faculty,
            attendance,
            guestNumber,
            special_facilities,
            comments
                ? String(comments).trim()
                : "",
            id
        ];

        db.query(
            sql,
            values,
            (error, result) => {

                if (error) {
                    console.error(
                        "Admin registration update error:",
                        error
                    );

                    return res.status(500).json({
                        message:
                            "Unable to update registration."
                    });
                }

                if (
                    result.affectedRows === 0
                ) {
                    return res.status(404).json({
                        message:
                            "Registration not found."
                    });
                }

                res.json({
                    message:
                        "Registration updated successfully."
                });
            }
        );
    }
);


/* =========================================
   ADMIN STATISTICS
========================================= */

app.get(
    "/api/admin/stats",
    requireAdmin,
    (req, res) => {

        const sql = `
            SELECT
                COUNT(*) AS total,
                SUM(attendance = 'Attend') AS attending,
                SUM(attendance = 'Not Attend') AS not_attending,
                SUM(guests) AS total_guests
            FROM registrations
        `;

        db.query(sql, (error, results) => {

            if (error) {

                console.error(error);

                return res.status(500).json({
                    message: "Unable to retrieve statistics."
                });
            }

            res.json(results[0]);
        });
    }
);

/* =========================================
   DELETE REGISTRATION
   Also delete:
   - Tracer Study proof
   - Payment receipt
========================================= */

app.delete(
    "/api/admin/registrations/:id",
    requireAdmin,
    (req, res) => {

        const id = Number(req.params.id);

        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({
                message: "Invalid registration ID."
            });
        }


        /* =========================================
           GET UPLOADED FILE NAMES FIRST
        ========================================= */

        db.query(
            `
            SELECT
                tracer_proof_path,
                payment_receipt_path
            FROM registrations
            WHERE id = ?
            LIMIT 1
            `,
            [id],
            (selectError, results) => {

                if (selectError) {

                    console.error(
                        "Unable to find registration:",
                        selectError
                    );

                    return res.status(500).json({
                        message:
                            "Unable to delete registration."
                    });
                }


                if (results.length === 0) {

                    return res.status(404).json({
                        message:
                            "Registration not found."
                    });
                }


                const tracerProofPath =
                    results[0].tracer_proof_path;

                const paymentReceiptPath =
                    results[0].payment_receipt_path;


                /* =========================================
                   DELETE DATABASE RECORD
                ========================================= */

                db.query(
                    "DELETE FROM registrations WHERE id = ?",
                    [id],
                    (deleteError, result) => {

                        if (deleteError) {

                            console.error(
                                "Unable to delete registration:",
                                deleteError
                            );

                            return res.status(500).json({
                                message:
                                    "Unable to delete registration."
                            });
                        }


                        if (result.affectedRows === 0) {

                            return res.status(404).json({
                                message:
                                    "Registration not found."
                            });
                        }


                        /* =========================================
                           DELETE TRACER STUDY PROOF
                        ========================================= */

                        if (tracerProofPath) {

                            const safeTracerFilename =
                                path.basename(
                                    tracerProofPath
                                );

                            const tracerFilePath =
                                path.join(
                                    tracerUploadDirectory,
                                    safeTracerFilename
                                );


                            if (
                                fs.existsSync(
                                    tracerFilePath
                                )
                            ) {

                                fs.unlink(
                                    tracerFilePath,
                                    (fileError) => {

                                        if (fileError) {

                                            console.error(
                                                "Unable to delete tracer proof:",
                                                fileError
                                            );

                                        } else {

                                            console.log(
                                                "Tracer proof deleted:",
                                                safeTracerFilename
                                            );
                                        }
                                    }
                                );
                            }
                        }


                        /* =========================================
                           DELETE PAYMENT RECEIPT
                        ========================================= */

                        if (paymentReceiptPath) {

                            const safePaymentFilename =
                                path.basename(
                                    paymentReceiptPath
                                );

                            const paymentFilePath =
                                path.join(
                                    paymentUploadDirectory,
                                    safePaymentFilename
                                );


                            if (
                                fs.existsSync(
                                    paymentFilePath
                                )
                            ) {

                                fs.unlink(
                                    paymentFilePath,
                                    (fileError) => {

                                        if (fileError) {

                                            console.error(
                                                "Unable to delete payment receipt:",
                                                fileError
                                            );

                                        } else {

                                            console.log(
                                                "Payment receipt deleted:",
                                                safePaymentFilename
                                            );
                                        }
                                    }
                                );
                            }
                        }


                        /* =========================================
                           SUCCESS
                        ========================================= */

                        res.json({
                            message:
                                "Registration and uploaded files deleted successfully."
                        });

                    }
                );
            }
        );
    }
);
/* =========================================
   EXPORT EXCEL
========================================= */

app.get(
    "/api/admin/export",
    requireAdmin,
    (req, res) => {

        db.query(
            `
            SELECT
                full_name,
                student_id,
                email,
                phone,
                programme,
                faculty,
                attendance,
                guests,
                special_facilities,
                comments,
                tracer_status,
                payment_status,
                payment_method,
                outstanding_status,
                registered_at
            FROM registrations
            ORDER BY registered_at DESC
            `,
            async (error, students) => {

                if (error) {
                    console.error(error);

                    return res.status(500).json({
                        message:
                            "Unable to export registrations."
                    });
                }

                try {

                    const workbook =
                        new ExcelJS.Workbook();

                    const worksheet =
                        workbook.addWorksheet(
                            "Convocation Registrations"
                        );

                    worksheet.columns = [

                        {
                            header: "No.",
                            key: "number",
                            width: 8
                        },

                        {
                            header: "Full Name",
                            key: "full_name",
                            width: 30
                        },

                        {
                            header: "Student ID",
                            key: "student_id",
                            width: 18
                        },

                        {
                            header: "Email",
                            key: "email",
                            width: 30
                        },

                        {
                            header: "Phone",
                            key: "phone",
                            width: 18
                        },

                        {
                            header: "Programme",
                            key: "programme",
                            width: 48
                        },

                        {
                            header: "Faculty",
                            key: "faculty",
                            width: 38
                        },

                        {
                            header: "Attendance",
                            key: "attendance",
                            width: 18
                        },

                        {
                            header: "Guests",
                            key: "guests",
                            width: 12
                        },

                        {
                            header: "Special Facilities",
                            key: "special_facilities",
                            width: 22
                        },

                        {
                            header: "Comments",
                            key: "comments",
                            width: 40
                        },

                        {
                            header: "Tracer Study Status",
                            key: "tracer_status",
                            width: 22
                        },

                        {
                            header: "Convocation Payment Status",
                            key: "payment_status",
                            width: 30
                        },

                        {
                            header: "Payment Method",
                            key: "payment_method",
                            width: 24
                        },

                        {
                            header: "Bursary Clearance Status",
                            key: "outstanding_status",
                            width: 28
                        },

                        {
                            header: "Registered At",
                            key: "registered_at",
                            width: 24
                        }

                    ];


                    students.forEach(
                        (student, index) => {

                            worksheet.addRow({

                                number:
                                    index + 1,

                                ...student

                            });

                        }
                    );


                    /* HEADER DESIGN */

                    const headerRow =
                        worksheet.getRow(1);

                    headerRow.font = {

                        bold: true,

                        color: {
                            argb:
                                "FFFFFFFF"
                        }

                    };

                    headerRow.fill = {

                        type: "pattern",

                        pattern: "solid",

                        fgColor: {
                            argb:
                                "FF101D38"
                        }

                    };


                    /* FREEZE HEADER ROW */

                    worksheet.views = [
                        {
                            state: "frozen",
                            ySplit: 1
                        }
                    ];


                    /* ENABLE FILTER */

                    worksheet.autoFilter = {

                        from: "A1",

                        to: "P1"

                    };


                    /* DOWNLOAD FILE */

                    res.setHeader(
                        "Content-Type",
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    );

                    res.setHeader(
                        "Content-Disposition",
                        'attachment; filename="convocation-registrations.xlsx"'
                    );


                    await workbook.xlsx.write(res);

                    res.end();


                } catch (exportError) {

                    console.error(
                        "Excel export error:",
                        exportError
                    );

                    if (!res.headersSent) {

                        return res
                            .status(500)
                            .json({
                                message:
                                    "Unable to create Excel file."
                            });

                    }
                }
            }
        );
    }
);

/* =========================================
   PAYMENT RECEIPT UPLOAD
========================================= */

const paymentUploadDirectory =
    path.join(
        __dirname,
        "private_uploads",
        "payment"
    );


if (!fs.existsSync(paymentUploadDirectory)) {
    fs.mkdirSync(
        paymentUploadDirectory,
        {
            recursive: true
        }
    );
}


const paymentStorage =
    multer.diskStorage({

        destination:
            function (
                req,
                file,
                cb
            ) {

                cb(
                    null,
                    paymentUploadDirectory
                );
            },

        filename:
            function (
                req,
                file,
                cb
            ) {

                const uniqueName =
                    Date.now() +
                    "-" +
                    Math.round(
                        Math.random() *
                        1E9
                    ) +
                    path.extname(
                        file.originalname
                    );

                cb(
                    null,
                    uniqueName
                );
            }
    });


const paymentUpload =
    multer({

        storage:
            paymentStorage,

        limits: {
            fileSize:
                5 * 1024 * 1024
        },

        fileFilter:
            function (
                req,
                file,
                cb
            ) {

                const allowedTypes = [
                    "image/jpeg",
                    "image/png",
                    "application/pdf"
                ];

                if (
                    allowedTypes.includes(
                        file.mimetype
                    )
                ) {

                    cb(
                        null,
                        true
                    );

                } else {

                    cb(
                        new Error(
                            "Only JPG, PNG and PDF files are allowed."
                        )
                    );
                }
            }
    });

/* =========================================
   BURSARY LOGIN
========================================= */

app.post("/api/bursary/login", bursaryloginLimiter, (req, res) => {
    const {
        username,
        password
    } = req.body;

    if (!username || !password) {
        return res.status(400).json({
            message: "Please enter username and password."
        });
    }

    if (
        username === process.env.BURSARY_USERNAME &&
        password === process.env.BURSARY_PASSWORD
    ) {
        req.session.bursary = true;

        return res.json({
            message: "Bursary login successful."
        });
    }

    return res.status(401).json({
        message: "Invalid Bursary username or password."
    });
});


app.post("/api/bursary/logout", (req, res) => {

    req.session.destroy((error) => {

        if (error) {
            return res.status(500).json({
                message: "Unable to log out."
            });
        }

        res.clearCookie("connect.sid");

        res.json({
            message: "Bursary logged out successfully."
        });
    });
});


app.get("/api/bursary/session", (req, res) => {
    res.json({
        loggedIn:
            req.session.bursary === true
    });
});


function requireBursary(
    req,
    res,
    next
) {
    if (
        req.session.bursary === true
    ) {
        return next();
    }

    return res.status(401).json({
        message:
            "Bursary authentication required."
    });
}

/* =========================================
   BURSARY PAYMENT LIST
========================================= */

app.get(
    "/api/bursary/payments",
    requireBursary,
    (req, res) => {

        const sql = `
            SELECT
                id,
                full_name,
                student_id,
                email,
                programme,
                payment_method,
                payment_status,
                payment_receipt_name,
                payment_uploaded_at,
                payment_verified_at,
                payment_remark,
                outstanding_status,
                outstanding_updated_at

            FROM registrations

            WHERE payment_receipt_path IS NOT NULL

            ORDER BY payment_uploaded_at DESC
        `;

        db.query(
            sql,
            (error, results) => {

                if (error) {
                    console.error(
                        "Bursary payment list error:",
                        error
                    );

                    return res.status(500).json({
                        message:
                            "Unable to load payment records."
                    });
                }

                res.json(results);
            }
        );
    }
);

app.get(
    "/api/bursary/payment-receipt/:id",
    requireBursary,
    (req, res) => {

        const studentId =
            req.params.id;

        const sql = `
            SELECT
                payment_receipt_path,
                payment_receipt_name

            FROM registrations

            WHERE id = ?

            LIMIT 1
        `;

        db.query(
            sql,
            [studentId],
            (error, results) => {

                if (error) {
                    console.error(
                        "Bursary receipt lookup error:",
                        error
                    );

                    return res.status(500).json({
                        message:
                            "Unable to load payment receipt."
                    });
                }

                if (
                    results.length === 0 ||
                    !results[0]
                        .payment_receipt_path
                ) {
                    return res.status(404).json({
                        message:
                            "Payment receipt not found."
                    });
                }

                const safeFileName =
                    path.basename(
                        results[0]
                            .payment_receipt_path
                    );

                const filePath =
                    path.join(
                        paymentUploadDirectory,
                        safeFileName
                    );

                if (
                    !fs.existsSync(
                        filePath
                    )
                ) {
                    return res.status(404).json({
                        message:
                            "Payment receipt file not found."
                    });
                }

                res.sendFile(
                    path.resolve(
                        filePath
                    )
                );
            }
        );
    }
);

app.patch(
    "/api/bursary/payments/:id/status",
    requireBursary,
    (req, res) => {

        const registrationId =
            req.params.id;

        const {
            status,
            remark
        } = req.body;

        const allowedStatuses = [
            "Payment Confirmed",
            "Rejected"
        ];

        if (
            !allowedStatuses.includes(
                status
            )
        ) {
            return res.status(400).json({
                message:
                    "Invalid payment status."
            });
        }

        const sql = `
            UPDATE registrations

            SET
                payment_status = ?,
                payment_verified_at = NOW(),
                payment_remark = ?

            WHERE id = ?
        `;

        db.query(
            sql,
            [
                status,
                remark || null,
                registrationId
            ],
            (error, result) => {

                if (error) {
                    console.error(
                        "Bursary payment status error:",
                        error
                    );

                    return res.status(500).json({
                        message:
                            "Unable to update payment status."
                    });
                }

                if (
                    result.affectedRows === 0
                ) {
                    return res.status(404).json({
                        message:
                            "Registration record not found."
                    });
                }

                res.json({
                    message:
                        `Payment status updated to ${status}.`
                });
            }
        );
    }
);

app.patch(
    "/api/bursary/registrations/:id/clearance",
    requireBursary,
    (req, res) => {

        const registrationId =
            req.params.id;

        const {
            status
        } = req.body;

        const allowedStatuses = [
            "Pending Update",
            "Outstanding",
            "Cleared",
            "Contact Bursary"
        ];

        if (
            !allowedStatuses.includes(
                status
            )
        ) {
            return res.status(400).json({
                message:
                    "Invalid Bursary clearance status."
            });
        }

        const sql = `
            UPDATE registrations

            SET
                outstanding_status = ?,
                outstanding_updated_at = NOW()

            WHERE id = ?
        `;

        db.query(
            sql,
            [
                status,
                registrationId
            ],
            (error, result) => {

                if (error) {
                    console.error(
                        "Bursary clearance update error:",
                        error
                    );

                    return res.status(500).json({
                        message:
                            "Unable to update Bursary clearance."
                    });
                }

                if (
                    result.affectedRows === 0
                ) {
                    return res.status(404).json({
                        message:
                            "Registration record not found."
                    });
                }

                res.json({
                    message:
                        `Bursary clearance updated to ${status}.`
                });
            }
        );
    }
);

app.post(
    "/api/student/payment-receipt",

    paymentUpload.single(
        "paymentReceipt"
    ),

    (req, res) => {

        const {
            student_id,
            email,
            payment_method
        } = req.body;


        if (
            !student_id ||
            !email ||
            !payment_method
        ) {

            if (req.file) {

                fs.unlink(
                    req.file.path,
                    () => {}
                );
            }

            return res.status(400).json({
                message:
                    "Please complete all required payment information."
            });
        }


        if (!req.file) {

            return res.status(400).json({
                message:
                    "Please upload your payment receipt."
            });
        }

        const allowedPaymentMethods = [
    "Student Portal",
    "Bank / Online Transfer",
    "One Stop Centre"
];

if (!allowedPaymentMethods.includes(payment_method)) {

    if (req.file) {
        fs.unlink(
            req.file.path,
            () => {}
        );
    }

    return res.status(400).json({
        message:
            "Invalid payment method selected."
    });
}


        const findStudentSql = `
            SELECT
                id,
                student_id,
                email,
                payment_receipt_path

            FROM registrations

            WHERE student_id = ?
            AND LOWER(email) = LOWER(?)

            LIMIT 1
        `;


        db.query(
            findStudentSql,
            [
                student_id.trim(),
                email.trim()
            ],

            (findError, results) => {

                if (findError) {

                    console.error(
                        "Payment student lookup error:",
                        findError
                    );

                    fs.unlink(
                        req.file.path,
                        () => {}
                    );

                    return res.status(500).json({
                        message:
                            "Unable to verify student information."
                    });
                }


                if (results.length === 0) {

                    fs.unlink(
                        req.file.path,
                        () => {}
                    );

                    return res.status(404).json({
                        message:
                            "No registration record was found. Please check your Student ID and registered email address."
                    });
                }


                const student =
                    results[0];


                const oldReceipt =
                    student.payment_receipt_path;


                const updateSql = `
                    UPDATE registrations

                    SET
                        payment_method = ?,
                        payment_receipt_path = ?,
                        payment_receipt_name = ?,
                        payment_status = ?,
                        payment_uploaded_at = NOW(),
                        payment_verified_at = NULL,
                        payment_remark = NULL

                    WHERE id = ?
                `;


                db.query(
                    updateSql,
                    [
                        payment_method,
                        req.file.filename,
                        req.file.originalname,
                        "Pending Bursary Verification",
                        student.id
                    ],

                    (updateError) => {

                        if (updateError) {

                            console.error(
                                "Payment receipt update error:",
                                updateError
                            );

                            fs.unlink(
                                req.file.path,
                                () => {}
                            );

                            return res.status(500).json({
                                message:
                                    "Unable to save payment receipt."
                            });
                        }


                        /*
                           Delete previous receipt
                           only after new receipt is saved
                        */

                        if (oldReceipt) {

                            const safeOldReceipt =
                                path.basename(
                                    oldReceipt
                                );

                            const oldReceiptPath =
                                path.join(
                                    paymentUploadDirectory,
                                    safeOldReceipt
                                );


                            if (
                                fs.existsSync(
                                    oldReceiptPath
                                )
                            ) {

                                fs.unlink(
                                    oldReceiptPath,
                                    (error) => {

                                        if (error) {

                                            console.error(
                                                "Unable to delete old payment receipt:",
                                                error
                                            );
                                        }
                                    }
                                );
                            }
                        }


                        res.json({
                            message:
                                "Payment receipt submitted successfully and is pending Bursary verification."
                        });
                    }
                );
            }
        );
    }
);

/* =========================================
   ERROR HANDLER
========================================= */

app.use((error, req, res, next) => {

if (error instanceof multer.MulterError) {

    if (error.code === "LIMIT_FILE_SIZE") {

        let message =
            "Uploaded file must not exceed 5 MB.";

        if (
            req.path ===
            "/api/student/payment-receipt"
        ) {
            message =
                "Payment receipt must not exceed 5 MB.";
        }

        if (
            req.path ===
            "/api/register"
        ) {
            message =
                "Tracer Study proof must not exceed 5 MB.";
        }

        return res.status(400).json({
            message
        });
    }

    return res.status(400).json({
        message:
            "File upload failed."
    });
}


    if (
        error &&
        error.message ===
        "Only JPG, PNG and PDF files are allowed."
    ) {

        return res.status(400).json({
            message:
                error.message
        });
    }


    console.error(error);

    res.status(500).json({
        message:
            "An unexpected server error occurred."
    });
});


/* =========================================
   START SERVER
========================================= */
app.listen(3000, () => {

    console.log(
        "✅ Convocation server is running!"
    );

    console.log(
        "Website: http://localhost:3000"
    );

    console.log(
        "Admin: http://localhost:3000/admin.html"
    );

});
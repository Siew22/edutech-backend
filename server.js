// =================================================================
//                 EduTech Platform - Backend Server
// =================================================================

const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const multer = require('multer');
const path = require('path');

const app = express();
const server = require('http').createServer(app);

// --- 中间件配置 ---
app.use(cors({ origin: '*' }));
app.use(express.json());

// --- 数据库连接池 ---
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'db',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'rootpass',
    database: process.env.DB_NAME || 'education_db',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// --- 文件上传 (Multer) 配置 ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => { cb(null, 'uploads/'); },
    filename: (req, file, cb) => { cb(null, Date.now() + path.extname(file.originalname)); }
});
const upload = multer({ storage: storage });
app.use('/uploads', (req, res, next) => {
    res.setHeader('ngrok-skip-browser-warning', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    next();
}, express.static(path.join(__dirname, 'uploads')));

// =================================================================
//                         API 路由定义
// =================================================================

// --- 1. 认证 (Auth) API ---

app.post('/api/register', async (req, res) => {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
        return res.status(400).json({ message: 'All fields are required.' });
    }

    const lowerEmail = email.toLowerCase();
    let role = '';

    if (lowerEmail.endsWith('@edutech.com')) {
        role = 'admin';
    } else if (lowerEmail.endsWith('@gmail.com')) {
        role = 'student';
    } else {
        return res.status(400).json({ message: 'Security Error: Only @gmail.com or @edutech.com domains are permitted.' });
    }

    try {
        const password_hash = await bcrypt.hash(password, 10);
        await pool.query(
            "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)",
            [name, email, password_hash, role]
        );
        res.status(201).json({ message: `${role === 'admin' ? 'Admin' : 'Student'} account created successfully! Please log in.` });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ message: 'This email address is already registered.' });
        }
        res.status(500).json({ message: 'Database error during registration.' });
    }
});

// [POST] /api/login (通用登录接口)
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ message: 'Email and password are required.' });
    }

    try {
        // 🚨🚨🚨 修复：把硬编码的特权登录通道加回来！🚨🚨🚨
        if (email.toLowerCase() === 'admin@edutech.com' && password === 'adminpass') {
            const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', ['admin@edutech.com']);
            const adminUser = rows[0] || { id: 1, name: 'Admin Manager', role: 'admin' };
            return res.json({ id: adminUser.id, name: adminUser.name, email: email, role: 'admin' });
        }
        if (email.toLowerCase() === 'student@test.com' && password === 'studentpass') {
             const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', ['student@test.com']);
            const studentUser = rows[0] || { id: 2, name: 'Student User', role: 'student' };
            return res.json({ id: studentUser.id, name: studentUser.name, email: email, role: 'student' });
        }
        // 🚨🚨🚨 修复结束 🚨🚨🚨

        // 其他正常注册用户的验证逻辑
        const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
        const user = rows[0];
        
        if (!user) return res.status(401).json({ message: 'Invalid email or password.' });

        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) return res.status(401).json({ message: 'Invalid email or password.' });

        res.json({ id: user.id, name: user.name, email: user.email, role: user.role });
    } catch (error) {
        res.status(500).json({ message: 'Server error during login.' });
    }
});


// --- 2. 内容 (Content) API ---
app.get('/api/books', async (req, res) => { const [rows] = await pool.query('SELECT * FROM books'); res.json(rows); });
app.get('/api/courses', async (req, res) => { const [rows] = await pool.query('SELECT * FROM courses'); res.json(rows); });
app.get('/api/resources', async (req, res) => { const [rows] = await pool.query('SELECT * FROM resources'); res.json(rows); });
app.get('/api/news', async (req, res) => { const [rows] = await pool.query('SELECT * FROM news ORDER BY id DESC'); res.json(rows); });
app.get('/api/events', async (req, res) => { const [rows] = await pool.query('SELECT * FROM events'); res.json(rows); });


// --- 3. 论坛 (Forum) API ---
app.get('/api/messages', async (req, res) => {
    try {
        const sql = `SELECT id, user_name, message, UNIX_TIMESTAMP(created_at) * 1000 AS created_at FROM forum_messages ORDER BY created_at ASC LIMIT 100`;
        const [rows] = await pool.query(sql);
        res.json(rows);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching messages' });
    }
});

app.post('/api/messages', async (req, res) => {
    const { userName, message } = req.body;
    try {
        await pool.query('INSERT INTO forum_messages (user_name, message) VALUES (?, ?)',[userName, message]);
        res.status(201).json({ success: true });
    } catch (error) {
        res.status(500).json({ message: 'Error saving message' });
    }
});


// --- 4. 搜索 (Search) API ---
app.get('/api/search', async (req, res) => {
    const query = req.query.q;
    if (!query) return res.json([]);

    try {
        const searchTerm = `%${query}%`;
        const [books] = await pool.query("SELECT id, title, price, level, cover_image_url as img FROM books WHERE title LIKE ?", [searchTerm]);
        const [courses] = await pool.query("SELECT id, title, price, level, img, duration, tag FROM courses WHERE title LIKE ?", [searchTerm]);
        const [resources] = await pool.query("SELECT id, title, price, level, img, duration, tag FROM resources WHERE title LIKE ?", [searchTerm]);

        const formattedBooks = books.map(item => ({ ...item, type: 'Book' }));
        const formattedCourses = courses.map(item => ({ ...item, type: 'Course' }));
        const formattedResources = resources.map(item => ({ ...item, type: 'Resource' }));

        const results = [...formattedBooks, ...formattedCourses, ...formattedResources];
        res.json(results);
    } catch (error) {
        res.status(500).json({ message: 'Error during search' });
    }
});


// --- 5. LMS API ---
app.post('/api/admin/order-status', async (req, res) => {
    const { orderId, newStatus } = req.body;
    try {
        await pool.query('UPDATE orders SET status = ? WHERE id = ?', [newStatus, orderId]);
        res.json({ message: `Order marked as ${newStatus}` });
    } catch (error) {
        res.status(500).json({ message: 'Failed to update order status' });
    }
});

// 1. 获取“我的学习”内容 (核心安全接口)
app.get('/api/my-learning', async (req, res) => {
    const userId = req.query.userId;
    if (!userId) return res.status(401).json({ message: 'User not authenticated' });
    try {
        const [orderItems] = await pool.query(`SELECT oi.item_id, oi.item_type FROM order_items oi JOIN orders o ON oi.order_id = o.id WHERE o.user_id = ? AND o.status = 'Completed'`, [userId]);
        const bookIds = orderItems.filter(i => i.item_type === 'book').map(i => i.item_id);
        const courseIds = orderItems.filter(i => i.item_type === 'course').map(i => i.item_id);
        const resourceIds = orderItems.filter(i => i.item_type === 'resource').map(i => i.item_id);
        let purchasedItems = [];
        if (bookIds.length > 0) { const [d] = await pool.query("SELECT *, 'book' as type FROM books WHERE id IN (?)", [bookIds]); purchasedItems.push(...d); }
        if (courseIds.length > 0) { const [d] = await pool.query("SELECT *, 'course' as type FROM courses WHERE id IN (?)", [courseIds]); purchasedItems.push(...d); }
        if (resourceIds.length > 0) { const [d] = await pool.query("SELECT *, 'resource' as type FROM resources WHERE id IN (?)", [resourceIds]); purchasedItems.push(...d); }
        res.json(purchasedItems);
    } catch (error) { res.status(500).json({ message: 'Failed to fetch learning materials.' }); }
});

// 2. 学生提交测验成绩
app.post('/api/quiz/submit', async (req, res) => {
    const { userId, userName, itemId, itemTitle, itemType, score } = req.body;
    try {
        await pool.query('INSERT INTO quiz_submissions (user_id, user_name, item_id, item_title, item_type, score) VALUES (?, ?, ?, ?, ?, ?)', [userId, userName, itemId, itemTitle, itemType, score]);
        res.status(201).json({ message: 'Score submitted successfully!' });
    } catch (error) { res.status(500).json({ message: 'Failed to submit score.' }); }
});

// 3. Admin 获取所有学生的成绩
app.get('/api/quiz/submissions', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM quiz_submissions ORDER BY submitted_at DESC');
        res.json(rows);
    } catch (error) { res.status(500).json({ message: 'Failed to fetch submissions.' }); }
});


// --- 6. 管理员 (Admin) API ---
app.post('/api/admin/add', async (req, res) => {
    // 🚨 接收全新的 targetLevel 字段
    const { type, title, price, img, category, duration, description, video_url, tutorial_pdf_url, quiz_url, softcopy_pdf_url, targetLevel, extra, event_date, start_time, end_time, apply_url } = req.body;
    try {
        if (type === 'Book') {
            await pool.query(
                'INSERT INTO books (title, price, cover_image_url, category, softcopy_pdf_url, level) VALUES (?, ?, ?, ?, ?, ?)',
                [title, price || 0, img, category, softcopy_pdf_url, targetLevel]
            );
        } else if (type === 'Course') {
            await pool.query(
                'INSERT INTO courses (title, description, duration, price, tag, img, video_url, tutorial_pdf_url, quiz_url, level) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [title, description, duration, price || 0, category, img, video_url, tutorial_pdf_url, quiz_url, targetLevel]
            );
        } else if (type === 'Resource') {
            await pool.query(
                'INSERT INTO resources (title, description, duration, price, tag, img, video_url, tutorial_pdf_url, quiz_url, level) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [title, description, duration, price || 0, category, img, video_url, tutorial_pdf_url, quiz_url, targetLevel]
            );
        } else if (type === 'News') {
        const today = new Date().toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
        await pool.query('INSERT INTO news (title, excerpt, full_content, img, news_date) VALUES (?, ?, ?, ?, ?)',[title, req.body.extra, req.body.description, img, today]);
        // ✅ 改成这样 (加入 img 和 apply_url)：
        } else if (type === 'Event') {
            await pool.query('INSERT INTO events (title, event_date, start_time, end_time, details, img, apply_url) VALUES (?, ?, ?, ?, ?, ?, ?)',[title, event_date, start_time, end_time, extra, img, apply_url]);
        }
        res.json({ message: `${type} added successfully to database!` });
    } catch (error) {
        res.status(500).json({ message: 'Database error while adding item.' });
    }
});

app.delete('/api/admin/delete/:type/:id', async (req, res) => {
    const { type, id } = req.params;
    let tableName = '';
    
    if (type === 'Book') tableName = 'books';
    else if (type === 'Course') tableName = 'courses';
    else if (type === 'Resource') tableName = 'resources';
    else if (type === 'News') tableName = 'news';
    else if (type === 'Event') tableName = 'events';
    else return res.status(400).json({ message: 'Invalid type' });

    try {
        await pool.query(`DELETE FROM ${tableName} WHERE id = ?`, [id]);
        res.json({ message: `${type} deleted successfully from database!` });
    } catch (error) {
        res.status(500).json({ message: 'Database error while deleting item.' });
    }
});

app.post('/api/admin/create', async (req, res) => {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ message: 'All fields are required.' });
    if (!email.toLowerCase().endsWith('@edutech.com')) return res.status(403).json({ message: 'CRITICAL SECURITY ERROR: Unauthorized domain. Only @edutech.com is permitted for Admin accounts.' });

    try {
        const password_hash = await bcrypt.hash(password, 10);
        await pool.query(
            "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'admin')",
            [name, email, password_hash]
        );
        res.status(201).json({ message: 'New Admin account created successfully!' });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'This Admin Email already exists in the database.' });
        res.status(500).json({ message: 'Database error while creating admin.' });
    }
});


// --- 7. 订单 (Order) API ---
app.get('/api/orders', async (req, res) => {
    const [rows] = await pool.query(`
        SELECT o.id, u.name as buyer, o.country, o.address, o.total_amount, o.status, o.shipping_method, o.payment_method, o.order_date
        FROM orders o JOIN users u ON o.user_id = u.id ORDER BY o.order_date DESC
    `);
    res.json(rows);
});

app.post('/api/orders', async (req, res) => {
    const { userId, cart, shippingDetails, paymentMethod } = req.body;
    const totalAmount = cart.reduce((sum, item) => sum + Number(item.price), 0);
    
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const [orderResult] = await connection.query(
            'INSERT INTO orders (user_id, total_amount, address, country, shipping_method, payment_method) VALUES (?, ?, ?, ?, ?, ?)',
            [userId, totalAmount, shippingDetails.address, shippingDetails.country, shippingDetails.shippingMethod, paymentMethod]
        );
        const orderId = orderResult.insertId;

        for (const item of cart) {
            await connection.query(
                'INSERT INTO order_items (order_id, item_id, item_type, quantity, price_at_purchase) VALUES (?, ?, ?, ?, ?)',
                [orderId, item.id, item.type, 1, item.price]
            );
        }

        await connection.commit();
        res.status(201).json({ message: 'Order created successfully!', orderId: orderId });
    } catch (error) {
        await connection.rollback();
        res.status(500).json({ message: 'Failed to create order.' });
    } finally {
        connection.release();
    }
});


// --- 8. 文件上传 (Upload) API ---
app.post('/api/upload', upload.single('media'), (req, res) => {
    if (!req.file) return res.status(400).send('No file uploaded.');
    
    const fileUrl = `${process.env.PUBLIC_URL || `http://localhost:5000`}/uploads/${req.file.filename}`;
    res.json({ 
        message: 'Upload successful', 
        url: fileUrl, 
        path: `/uploads/${req.file.filename}`
    });
});


// =================================================================
//                         启动服务器
// =================================================================
const PORT = 5000;
server.listen(PORT, () => {
    console.log(`✅ Backend Server is fully operational on port ${PORT}`);
});
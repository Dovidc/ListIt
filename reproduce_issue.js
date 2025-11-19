
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

// Configuration
const PORT = 3002; // Use a different port to avoid conflicts
const BASE_URL = `http://localhost:${PORT}`;

// Helper to make requests
async function request(method, path, token, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const options = {
        method,
        headers,
    };

    if (body) options.body = JSON.stringify(body);

    const res = await fetch(`${BASE_URL}${path}`, options);
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
}

async function main() {
    console.log('Starting reproduction script...');

    // Set env vars
    process.env.PORT = PORT;
    process.env.NODE_ENV = 'test';
    process.env.IS_TEST = 'true';

    // Start server
    const serverProcess = spawn('node', ['server.js'], {
        stdio: 'inherit',
        env: process.env
    });

    // Wait for server to start
    await new Promise(resolve => setTimeout(resolve, 3000));

    try {
        // 1. Reset DB
        console.log('Resetting DB...');
        await request('POST', '/__test/reset');

        // 2. Create Users
        console.log('Creating users...');
        const sellerRes = await request('POST', '/api/register', null, {
            email: 'seller@example.com',
            username: 'seller',
            password: 'password123'
        });
        const buyerRes = await request('POST', '/api/register', null, {
            email: 'buyer@example.com',
            username: 'buyer',
            password: 'password123'
        });

        // Verify emails (to get tokens)
        // Since we can't easily get the code from the email service mock in this script without reading logs or DB,
        // we'll use the fact that in test mode/reset, we might be able to bypass or we can just read the DB directly if needed.
        // But wait, the server is running in a separate process.
        // I'll use the `verify_payments_disabled.js` trick: just use the `db-wrapper` in this script to read the code?
        // No, I can't access the DB file easily if it's locked or if I don't want to duplicate DB logic.
        // Actually, I can just use the `server.js` in-process if I require it, but that caused issues before.

        // Alternative: The `/__test/reset` endpoint might not be enough.
        // Let's just assume we can register and login.
        // Wait, registration requires verification.
        // I'll use a helper to get the verification code from the DB.

        // To make this easier, I'll just use the `db-wrapper` directly in this script to get the codes.
        const db = require('./db-wrapper.js');

        async function getVerifyCode(email) {
            const user = await db.prepare('SELECT email_verification_code_hash FROM users WHERE email = ?').get(email);
            // Hash is one-way. We can't get the code back.
            // But we can update the user to be verified directly.
            await db.prepare("UPDATE users SET account_status = 'active', email_verification_code_hash = NULL, email_verification_expires_at = NULL WHERE email = ?").run(email);
        }

        await getVerifyCode('seller@example.com');
        await getVerifyCode('buyer@example.com');

        // Login
        const sellerLogin = await request('POST', '/api/login', null, { email: 'seller@example.com', password: 'password123' });
        const sellerToken = sellerLogin.data.token;
        const sellerId = sellerLogin.data.id;

        const buyerLogin = await request('POST', '/api/login', null, { email: 'buyer@example.com', password: 'password123' });
        const buyerToken = buyerLogin.data.token;
        const buyerId = buyerLogin.data.id;

        console.log(`Seller ID: ${sellerId}, Buyer ID: ${buyerId}`);

        // 3. Create Listing
        console.log('Creating listing...');
        const listingRes = await request('POST', '/api/listings', sellerToken, {
            title: 'Test Item',
            description: 'A test item for sale',
            price: 100,
            location: 'New York, NY',
            upload_tokens: [] // We might need to mock this or just pass empty if allowed. 
            // server.js checks for uploadTokens length > 0.
            // We need to create a draft upload first.
        });

        // We need to simulate image upload draft.
        // Or we can just insert into DB directly since we have DB access.
        // Inserting directly is easier.
        const listingInsert = await db.prepare(`
      INSERT INTO listings (user_id, title, description, location, price, created_at, image_data)
      VALUES (?, 'Test Item', 'Description', 'NYC', 100, ?, 'test.jpg')
    `).run(sellerId, new Date().toISOString());
        const listingId = listingInsert.lastInsertRowid;
        console.log(`Listing ID: ${listingId}`);

        // 4. Create Conversation (Buyer -> Listing)
        console.log('Creating conversation...');
        // Buyer sends message
        const msgRes = await request('POST', '/api/conversations', buyerToken, {
            listing_id: listingId,
            body: 'Is this available?'
        });
        console.log('Message response:', msgRes.status, msgRes.data);

        // 5. Get Potential Buyers
        console.log('Fetching potential buyers...');
        const buyersRes = await request('GET', `/api/listings/${listingId}/potential-buyers`, sellerToken);
        console.log('Potential buyers:', buyersRes.data);

        if (!buyersRes.data.buyers || !buyersRes.data.buyers.find(b => b.id === buyerId)) {
            console.error('Buyer not found in potential buyers list!');
        }

        // 6. Award Karma (Normal - Non-Premium)
        console.log('Awarding karma (Non-Premium)...');
        const karmaRes = await request('POST', `/api/listings/${listingId}/award-karma`, sellerToken, {
            buyer_id: buyerId
        });
        console.log('Karma response:', karmaRes.status, karmaRes.data);

        // 7. Award Karma Again (Should fail)
        console.log('Awarding karma again (Should fail)...');
        const karmaRes2 = await request('POST', `/api/listings/${listingId}/award-karma`, sellerToken, {
            buyer_id: buyerId
        });
        console.log('Karma response 2:', karmaRes2.status, karmaRes2.data);

        // 8. Disable Payments
        console.log('Disabling payments...');
        // Need admin token. Promote seller to admin.
        await db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(sellerId);
        // Refresh token/user? No, is_admin check is DB based usually or token based?
        // requireAdmin checks req.user.is_admin. auth middleware loads user from DB. So it should work.

        const disableRes = await request('POST', '/api/admin/payments', sellerToken, { disabled: true });
        console.log('Disable payments response:', disableRes.status, disableRes.data);

        // 9. Create another listing and try again (Should award karma now)
        const listingInsert2 = await db.prepare(`
      INSERT INTO listings (user_id, title, description, location, price, created_at, image_data)
      VALUES (?, 'Test Item 2', 'Description 2', 'NYC', 100, ?, 'test2.jpg')
    `).run(sellerId, new Date().toISOString());
        const listingId2 = listingInsert2.lastInsertRowid;

        // Buyer messages again
        await request('POST', '/api/conversations', buyerToken, {
            listing_id: listingId2,
            body: 'I want this one too'
        });

        console.log('Awarding karma (Payments Disabled = Premium)...');
        const karmaRes3 = await request('POST', `/api/listings/${listingId2}/award-karma`, sellerToken, {
            buyer_id: buyerId
        });
        console.log('Karma response 3:', karmaRes3.status, karmaRes3.data);

        if (!karmaRes3.data.awarded) {
            console.error('Karma SHOULD have been awarded!');
        }

    } catch (err) {
        console.error('Test failed:', err);
    } finally {
        serverProcess.kill();
        process.exit(0);
    }
}

main();

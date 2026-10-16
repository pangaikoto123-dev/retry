# QR Attendance (PWA)

This repository contains a small Progressive Web App and a Node.js backend for QR-code-based attendance. Teachers can sign up, create random QR codes, and view student submissions. Students scan a QR and fill a small form.

Run locally:

1. Install dependencies

   npm install

2. Start the server

   npm start

3. Open http://localhost:3000

Notes:

- The server uses a local SQLite database at ./data.db by default.
- For production, set environment variable JWT_SECRET to a secure value and consider a persistent DB and HTTPS.
- This is a minimal prototype: input validation, rate limiting, and security hardening are recommended before production use.

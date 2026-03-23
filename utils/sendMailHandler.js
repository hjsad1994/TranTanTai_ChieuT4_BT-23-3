require('dotenv').config({ quiet: true })

let nodemailer = require('nodemailer')

const IMPORT_BANNER_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="640" height="220" viewBox="0 0 640 220" fill="none">
  <rect width="640" height="220" rx="28" fill="#0F172A"/>
  <circle cx="544" cy="72" r="88" fill="#1D4ED8" fill-opacity="0.18"/>
  <circle cx="594" cy="174" r="96" fill="#22C55E" fill-opacity="0.14"/>
  <text x="40" y="88" fill="#F8FAFC" font-size="32" font-family="Arial, Helvetica, sans-serif" font-weight="700">Your account is ready</text>
  <text x="40" y="126" fill="#CBD5E1" font-size="18" font-family="Arial, Helvetica, sans-serif">Login credentials were generated from the imported Excel file.</text>
  <rect x="40" y="154" width="176" height="34" rx="17" fill="#16A34A"/>
  <text x="62" y="176" fill="#F8FAFC" font-size="16" font-family="Arial, Helvetica, sans-serif" font-weight="700">Welcome to the system</text>
</svg>`

function getTransporter() {
    if (!process.env.MAILTRAP_USER || !process.env.MAILTRAP_PASS) {
        throw new Error('Missing MAILTRAP_USER or MAILTRAP_PASS in environment')
    }

    return nodemailer.createTransport({
        host: process.env.MAILTRAP_HOST || 'sandbox.smtp.mailtrap.io',
        port: Number(process.env.MAILTRAP_PORT || 2525),
        auth: {
            user: process.env.MAILTRAP_USER,
            pass: process.env.MAILTRAP_PASS
        }
    })
}

function getMailtrapSender() {
    return process.env.MAIL_FROM || 'admin@nnptud.com'
}

module.exports = {
    sendMail: async function (to, url) {
        await getTransporter().sendMail({
            from: `"admin" <${getMailtrapSender()}>`,
            to: to,
            subject: 'Reset your password',
            text: `Reset your password here: ${url}`,
            html: `<p>Reset your password here: <a href="${url}">${url}</a></p>`
        })
    },
    sendImportedUserPasswordMail: async function (to, username, password) {
        await getTransporter().sendMail({
            from: `"admin" <${getMailtrapSender()}>`,
            to: to,
            subject: 'Your new account password',
            text: `Hello ${username}, your account has been created. Username: ${username}. Password: ${password}`,
            html: `
                <div style="margin:0;padding:24px;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
                    <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:24px;overflow:hidden;border:1px solid #e2e8f0;">
                        <img src="cid:user-import-banner" alt="User import banner" style="display:block;width:100%;height:auto;border:0;" />
                        <div style="padding:32px;">
                            <h1 style="margin:0 0 16px;font-size:28px;line-height:1.3;">Hello ${username},</h1>
                            <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#334155;">Your account was created successfully from the user import file. Use the credentials below to sign in.</p>
                            <div style="padding:20px;border-radius:18px;background:#eff6ff;border:1px solid #bfdbfe;">
                                <p style="margin:0 0 12px;font-size:15px;"><strong>Username:</strong> ${username}</p>
                                <p style="margin:0 0 12px;font-size:15px;"><strong>Email:</strong> ${to}</p>
                                <p style="margin:0;font-size:15px;"><strong>Password:</strong> ${password}</p>
                            </div>
                            <p style="margin:24px 0 0;font-size:14px;line-height:1.6;color:#64748b;">For security, please change this password after your first login.</p>
                        </div>
                    </div>
                </div>
            `,
            attachments: [
                {
                    filename: 'user-import-banner.svg',
                    content: IMPORT_BANNER_SVG,
                    contentType: 'image/svg+xml',
                    cid: 'user-import-banner'
                }
            ]
        })
    }
}

const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const express = require('express');
const { toDataURL } = require('qrcode');

const app = express();
const port = process.env.PORT || 8080;

let latestQR = '';
let connectionStatus = 'Menghubungkan...';

const UNIVERSAL_WEBAPP_URL = "https://script.google.com/macros/s/AKfycbyQFI6i-TjF-YOzH48-_1BRw0lh1-F16NMKB6v45kpyUQmXvUNAjcsU9gJEYinb2t8C";

// Setup Web Server untuk nampilin QR Code di browser HP
app.get('/', async (req, res) => {
    if (connectionStatus === 'Terhubung') {
        return res.send(`
            <div style="text-align:center; margin-top:50px; font-family:sans-serif;">
                <h2 style="color:green;">✅ Bot WhatsApp Berhasil Terhubung!</h2>
                <p>Sesi aktif dan bot sudah siap digunakan.</p>
            </div>
        `);
    }

    if (!latestQR) {
        return res.send(`
            <div style="text-align:center; margin-top:50px; font-family:sans-serif;">
                <h2>⏳ Menyiapkan QR Code...</h2>
                <p>Silakan refresh halaman ini beberapa saat lagi.</p>
            </div>
        `);
    }

    try {
        const url = await toDataURL(latestQR);
        res.send(`
            <div style="text-align:center; margin-top:30px; font-family:sans-serif;">
                <h2>📱 Scan QR Code WhatsApp Bot</h2>
                <p>Gunakan WhatsApp di HP kamu untuk scan QR di bawah ini:</p>
                <img src="${url}" alt="QR Code" style="width:280px;height:280px; border: 5px solid #ccc; border-radius: 10px;" />
                <p style="color:gray; font-size:12px; margin-top:20px;">Refresh halaman ini jika QR kedaluwarsa.</p>
            </div>
        `);
    } catch (err) {
        res.status(500).send('Gagal generate QR Code');
    }
});

app.listen(port, () => {
    console.log(`Web server QR aktif di port ${port}`);
});

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            latestQR = qr;
            connectionStatus = 'Menunggu Scan QR';
            console.log("👉 QR Code baru diterima, silakan buka browser web app kamu.");
        }

        if (connection === 'close') {
            connectionStatus = 'Terputus';
            latestQR = '';
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) connectToWhatsApp();
        } else if (connection === 'open') {
            connectionStatus = 'Terhubung';
            latestQR = '';
            console.log('✅ Bot WhatsApp berhasil terhubung dan aktif!');
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const sender = msg.key.remoteJid;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
        if (!text) return;

        const args = text.trim().split(' ');
        const command = args[0].toLowerCase();

        if (command === 'masuk' || command === 'keluar') {
            const nominal = args[1];
            const keterangan = args.slice(2).join(' ');

            if (!nominal || isNaN(nominal) || !keterangan) {
                await sock.sendMessage(sender, { 
                    text: "Format salah!\nGunakan:\n• masuk [nominal] [keterangan]\n• keluar [nominal] [keterangan]" 
                });
                return;
            }

            const now = new Date();
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const year = now.getFullYear();
            const bulanTahunKey = `${month}-${year}`;

            let payload = { 
                bulanTahun: bulanTahunKey,
                keterangan: keterangan 
            };
            if (command === 'masuk') payload.pemasukan = nominal;
            if (command === 'keluar') payload.pengeluaran = nominal;

            try {
                await fetch(UNIVERSAL_WEBAPP_URL, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload)
                });
                
                await sock.sendMessage(sender, { 
                    text: `✅ Berhasil dicatat (${bulanTahunKey}):\n${command.toUpperCase()} Rp${Number(nominal).toLocaleString('id-ID')} (${keterangan})` 
                });
            } catch (err) {
                await sock.sendMessage(sender, { text: "❌ Gagal menyimpan ke laporan keuangan." });
            }
        }
    });
}

connectToWhatsApp();

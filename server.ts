/**
 * 🛠️ Invoice Extractor Backend Server
 * ---------------------------------------------------------
 * Handles WebSocket presence, API routing, and Vite integration.
 * 
 * @author AI Studio Build Agent
 */

import express from "express";
import { createServer as createViteServer } from "vite";
import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import path from "path";

async function startServer() {
  const app = express();
  const server = createServer(app);
  const PORT = 3000;

  // WebSocket Server
  const wss = new WebSocketServer({ server });
  const activeUsers = new Map<string, { name: string; status: 'online' | 'offline' }>();

  wss.on('connection', (ws: WebSocket) => {
    let userId: string | null = null;

    ws.on('message', (message: string) => {
      try {
        const data = JSON.parse(message);
        if (data.type === 'login') {
          userId = data.userId;
          activeUsers.set(userId!, { name: data.name, status: 'online' });
          broadcastUsers();
        }
        if (data.type === 'kick') {
          const targetId = data.targetId;
          if (activeUsers.has(targetId)) {
            activeUsers.delete(targetId);
            broadcastUsers();
            // Optionally notify the kicked user
            wss.clients.forEach(client => {
              // We don't easily know which client is which without mapping ws to userId
              // But we can broadcast a 'kicked' message with targetId
              if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: 'user_kicked', targetId }));
              }
            });
          }
        }
        if (data.type === 'ping') {
          if (userId && activeUsers.has(userId)) {
             activeUsers.get(userId)!.status = 'online';
             broadcastUsers();
          }
        }
      } catch (e) {
        console.error("WS error:", e);
      }
    });

    ws.on('close', () => {
      if (userId) {
        // Instead of deleting, mark as offline for a bit or just remove
        // For this app, let's just remove to keep it simple, or keep for "offline" status
        const user = activeUsers.get(userId);
        if (user) {
          user.status = 'offline';
          broadcastUsers();
          // Remove after 30 seconds if they don't reconnect
          setTimeout(() => {
            if (activeUsers.get(userId)?.status === 'offline') {
              activeUsers.delete(userId);
              broadcastUsers();
            }
          }, 30000);
        }
      }
    });

    function broadcastUsers() {
      const usersList = Array.from(activeUsers.entries()).map(([id, data]) => ({
        id,
        ...data
      }));
      const payload = JSON.stringify({ type: 'users_update', users: usersList });
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(payload);
        }
      });
    }
  });

  // API routes
  app.use(express.json({ limit: '50mb' })); // Increase limit for large exports

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/api/config", (req, res) => {
    // Expose the API key to the frontend if it's set in the environment
    // This allows the app to work "for everyone" without individual keys
    res.json({ 
      geminiApiKey: process.env.GEMINI_API_KEY || process.env.API_KEY || ""
    });
  });

  app.post("/api/export/email", async (req, res) => {
    const { to, subject, body, format, data, filename } = req.body;

    if (!to || !subject || !data) {
      return res.status(400).json({ error: "Missing required fields: to, subject, data" });
    }

    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;

    if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
      return res.status(503).json({ 
        error: "Email service not configured. Please set SMTP_HOST, SMTP_USER, and SMTP_PASS in environment variables." 
      });
    }

    try {
      const nodemailer = await import("nodemailer");
      const transporter = nodemailer.default.createTransport({
        host: SMTP_HOST,
        port: parseInt(SMTP_PORT || "587"),
        secure: SMTP_PORT === "465",
        auth: {
          user: SMTP_USER,
          pass: SMTP_PASS,
        },
      });

      let attachmentContent: string | Buffer = data;
      let contentType = "text/plain";

      if (format === "json") {
        attachmentContent = JSON.stringify(data, null, 2);
        contentType = "application/json";
      } else if (format === "csv") {
        attachmentContent = data; // Assuming data is already CSV string from client
        contentType = "text/csv";
      }

      const mailOptions = {
        from: SMTP_FROM || SMTP_USER,
        to,
        subject,
        text: body || "Please find the attached invoice data export.",
        attachments: [
          {
            filename: `${filename || 'invoice_export'}.${format}`,
            content: attachmentContent,
            contentType,
          },
        ],
      };

      await transporter.sendMail(mailOptions);
      res.json({ success: true, message: "Email sent successfully" });
    } catch (error: any) {
      console.error("Email error:", error);
      res.status(500).json({ error: `Failed to send email: ${error.message}` });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

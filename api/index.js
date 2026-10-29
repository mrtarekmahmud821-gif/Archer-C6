const express = require("express");
const crypto = require("crypto");
const admin = require("firebase-admin");

const app = express();
app.use(express.json({ limit: "32kb" }));
app.use(express.static(require("path").join(__dirname, "..")));

const {
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_BOT_USERNAME = "YOUR_BOT_USERNAME",
  FIREBASE_SERVICE_ACCOUNT_JSON,
  ADSGRAM_REWARD_SECRET,
  ADMIN_TELEGRAM_IDS = "",
  AD_REWARD_POINTS = "5",
  REFERRAL_REWARD_POINTS = "100",
  GAME_ROUND_REWARD_POINTS = "10",
  MIN_WITHDRAW_POINTS = "1000"
} = process.env;

if (!admin.apps.length && FIREBASE_SERVICE_ACCOUNT_JSON) {
  admin.initializeApp({
    credential: admin.credential.cert(
      JSON.parse(FIREBASE_SERVICE_ACCOUNT_JSON)
    )
  });
}

const db = admin.apps.length ? admin.firestore() : null;
const admins = new Set(
  ADMIN_TELEGRAM_IDS.split(",").map(x => x.trim()).filter(Boolean)
);

const numberEnv = (value, fallback) => {
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : fallback;
};

const AD_POINTS = numberEnv(AD_REWARD_POINTS, 5);
const REF_POINTS = numberEnv(REFERRAL_REWARD_POINTS, 100);
const GAME_POINTS = numberEnv(GAME_ROUND_REWARD_POINTS, 10);
const MIN_WITHDRAW = numberEnv(MIN_WITHDRAW_POINTS, 1000);

function verifyTelegramInitData(initData) {
  if (!TELEGRAM_BOT_TOKEN || !initData) {
    throw new Error("Telegram authentication required");
  }

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");

  if (!hash) throw new Error("Missing Telegram signature");

  params.delete("hash");

  const authDate = Number(params.get("auth_date") || 0);
  const now = Math.floor(Date.now() / 1000);

  if (!authDate || now - authDate > 3600 || authDate > now + 30) {
    throw new Error("Telegram session expired");
  }

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(TELEGRAM_BOT_TOKEN)
    .digest();

  const expectedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest();

  let suppliedHash;
  try {
    suppliedHash = Buffer.from(hash, "hex");
  } catch {
    throw new Error("Invalid Telegram signature");
  }

  if (
    suppliedHash.length !== expectedHash.length ||
    !crypto.timingSafeEqual(suppliedHash, expectedHash)
  ) {
    throw new Error("Invalid Telegram signature");
  }

  const user = JSON.parse(params.get("user") || "{}");

  if (!user.id || !Number.isSafeInteger(Number(user.id))) {
    throw new Error("Invalid Telegram user");
  }

  return {
    id: String(user.id),
    name: String(user.first_name || "Player").slice(0, 80),
    username: String(user.username || "").slice(0, 80)
  };
}

function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    if (!header.startsWith("tma ")) {
      return res.status(401).json({ error: "Telegram login required" });
    }

    req.user = verifyTelegramInitData(header.slice(4));
    next();
  } catch (error) {
    res.status(401).json({ error: error.message });
  }
}

function requireAdmin(req, res, next) {
  if (!admins.has(req.user.id)) {
    return res.status(403).json({ error: "Admin access denied" });
  }
  next();
}

function requireDb(req, res, next) {
  if (!db) {
    return res.status(503).json({ error: "Firebase server config missing" });
  }
  next();
}

app.get("/api/config", (req, res) => {
  res.json({ botUsername: TELEGRAM_BOT_USERNAME });
});

app.get("/api/me", requireAuth, requireDb, async (req, res) => {
  try {
    const ref = db.collection("users").doc(req.user.id);

    await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      if (!snap.exists) {
        tx.set(ref, {
          telegramId: req.user.id,
          firstName: req.user.name,
          username: req.user.username,
          balance: 0,
          totalHits: 0,
          rounds: 0,
          adsCompleted: 0,
          referrals: 0,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }
    });

    const snap = await ref.get();
    res.json(snap.data());
  } catch {
    res.status(500).json({ error: "Could not load profile" });
  }
});

/*
 * Adsgram Reward URL:
 * https://YOUR_DOMAIN/api/adsgram/reward?userid=[userId]&key=YOUR_SECRET
 *
 * Configure this URL in the Adsgram dashboard only.
 * The callback documentation describes a Telegram user ID, but does not
 * provide a unique event ID in this URL format. We therefore apply a
 * per-user cooldown. This is not equivalent to signed event-level proof.
 */
app.get("/api/adsgram/reward", requireDb, async (req, res) => {
  const userId = String(req.query.userid || "");
  const suppliedKey = String(req.query.key || "");

  if (
    !ADSGRAM_REWARD_SECRET ||
    suppliedKey.length !== ADSGRAM_REWARD_SECRET.length ||
    !crypto.timingSafeEqual(
      Buffer.from(suppliedKey),
      Buffer.from(ADSGRAM_REWARD_SECRET)
    )
  ) {
    return res.status(401).send("Unauthorized");
  }

  if (!/^\d{1,20}$/.test(userId)) {
    return res.status(400).send("Invalid user ID");
  }

  try {
    const userRef = db.collection("users").doc(userId);
    const claimRef = db.collection("adRewardLocks").doc(userId);
    const txRef = db.collection("transactions").doc(
      `adsgram_${userId}_${crypto.randomUUID()}`
    );

    await db.runTransaction(async tx => {
      const userSnap = await tx.get(userRef);
      const claimSnap = await tx.get(claimRef);

      if (!userSnap.exists) throw new Error("USER_NOT_REGISTERED");

      const now = Date.now();
      const lastAt = claimSnap.exists
        ? Number(claimSnap.data().lastAt || 0)
        : 0;

      if (now - lastAt < 60_000) {
        throw new Error("REWARD_COOLDOWN");
      }

      tx.update(userRef, {
        balance: admin.firestore.FieldValue.increment(AD_POINTS),
        adsCompleted: admin.firestore.FieldValue.increment(1)
      });

      tx.set(claimRef, { lastAt: now });

      tx.create(txRef, {
        telegramId: userId,
        type: "adsgram_reward",
        points: AD_POINTS,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    });

    res.status(200).send("OK");
  } catch (error) {
    if (error.message === "REWARD_COOLDOWN") {
      return res.status(409).send("Cooldown");
    }
    if (error.message === "USER_NOT_REGISTERED") {
      return res.status(404).send("User not registered");
    }
    res.status(500).send("Reward processing failed");
  }
});

/* User submits a bKash withdrawal request; this does not send money. */
app.post(
  "/api/withdrawals",
  requireAuth,
  requireDb,
  async (req, res) => {
    const points = Number(req.body.points);
    const bkashNumber = String(req.body.bkashNumber || "").trim();

    if (
      !Number.isSafeInteger(points) ||
      points < MIN_WITHDRAW ||
      points > 1_000_000_000
    ) {
      return res.status(400).json({ error: "Invalid withdrawal amount" });
    }

    if (!/^01[3-9]\d{8}$/.test(bkashNumber)) {
      return res.status(400).json({ error: "Invalid Bangladesh mobile number" });
    }

    try {
      const userRef = db.collection("users").doc(req.user.id);
      const withdrawalRef = db.collection("withdrawals").doc();
      const transactionRef = db.collection("transactions").doc();

      await db.runTransaction(async tx => {
        const snap = await tx.get(userRef);
        if (!snap.exists) throw new Error("USER_NOT_FOUND");

        const balance = Number(snap.data().balance || 0);
        if (balance < points) throw new Error("INSUFFICIENT_BALANCE");

        tx.update(userRef, {
          balance: balance - points,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        tx.create(withdrawalRef, {
          telegramId: req.user.id,
          points,
          bkashNumber,
          status: "pending",
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        tx.create(transactionRef, {
          telegramId: req.user.id,
          type: "withdrawal_request",
          points: -points,
          withdrawalId: withdrawalRef.id,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
      });

      res.json({
        success: true,
        message: "Withdrawal request submitted for admin review."
      });
    } catch (error) {
      const message = {
        USER_NOT_FOUND: "User not found",
        INSUFFICIENT_BALANCE: "Insufficient points"
      }[error.message];

      res.status(message ? 400 : 500).json({
        error: message || "Withdrawal request failed"
      });
    }
  }
);

/* Admin: list pending withdrawal requests. */
app.get(
  "/api/admin/withdrawals",
  requireAuth,
  requireAdmin,
  requireDb,
  async (req, res) => {
    try {
      const snap = await db.collection("withdrawals")
        .where("status", "==", "pending")
        .limit(100)
        .get();

      res.json(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    } catch {
      res.status(500).json({ error: "Could not load withdrawals" });
    }
  }
);

/* Admin approves or rejects. Approval means manually pay via bKash first. */
app.post(
  "/api/admin/withdrawals/:id/review",
  requireAuth,
  requireAdmin,
  requireDb,
  async (req, res) => {
    const decision = req.body.decision;
    const note = String(req.body.note || "").slice(0, 300);

    if (!["approve", "reject"].includes(decision)) {
      return res.status(400).json({ error: "Invalid decision" });
    }

    try {
      const withdrawalRef = db.collection("withdrawals").doc(req.params.id);

      await db.runTransaction(async tx => {
        const withdrawalSnap = await tx.get(withdrawalRef);

        if (!withdrawalSnap.exists) throw new Error("NOT_FOUND");

        const withdrawal = withdrawalSnap.data();
        if (withdrawal.status !== "pending") {
          throw new Error("ALREADY_REVIEWED");
        }

        if (decision === "reject") {
          const userRef = db.collection("users").doc(withdrawal.telegramId);
          const userSnap = await tx.get(userRef);

          if (!userSnap.exists) throw new Error("USER_NOT_FOUND");

          tx.update(userRef, {
            balance: admin.firestore.FieldValue.increment(withdrawal.points)
          });

          const refundRef = db.collection("transactions").doc();
          tx.create(refundRef, {
            telegramId: withdrawal.telegramId,
            type: "withdrawal_refund",
            points: withdrawal.points,
            withdrawalId: withdrawalRef.id,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
          });
        }

        tx.update(withdrawalRef, {
          status: decision === "approve" ? "approved" : "rejected",
          adminNote: note,
          reviewedBy: req.user.id,
          reviewedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      });

      res.json({ success: true });
    } catch (error) {
      const status = ["NOT_FOUND", "ALREADY_REVIEWED", "USER_NOT_FOUND"]
        .includes(error.message) ? 400 : 500;
      res.status(status).json({ error: error.message || "Review failed" });
    }
  }
);

app.get("/api/health", (req, res) => res.json({ ok: true }));

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Bird Rush API on ${port}`));
}

module.exports = app;

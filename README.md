# Bird Rush — Telegram Mini App starter

A mobile-first Telegram Mini App starter with:
- Home arcade screen: original flying-bird targets and movable cannon
- Round counter: 100 hits completes a demo round; demo balance adds 10 points
- Profile, Tasks, Referral and Wallet-style balance/history UI foundation
- Telegram Web App SDK user greeting and share-link pattern
- Express API starter with Telegram `initData` signature verification
- Firebase Admin setup point for server-owned balances

## Branding
This uses an original stylized bird mascot and pink arcade palette. It does **not** contain the bKash logo and is not affiliated with bKash. Only use third-party marks with permission.

## Run locally
1. Install Node.js 20+.
2. `npm install`
3. `npm start`
4. Open `http://localhost:3000` only after adding a static server or use your preferred local static preview. For API mode, the Express file below currently needs a static middleware (see note).

To serve the front-end locally from Express, add this line after `app.use(express.json(...))` in `api/index.js`:
```js
app.use(express.static(require("path").join(__dirname, "..")));
```
Then start with `npm start` and open `http://localhost:3000`.

## Telegram setup
1. Create a bot using BotFather.
2. Configure the Mini App URL in BotFather (HTTPS required).
3. Deploy the frontend to HTTPS.
4. Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_BOT_USERNAME` as server environment variables.
5. Add `FIREBASE_SERVICE_ACCOUNT_JSON` as a Vercel environment variable, or use your platform's secure service-account configuration.
6. Update `APP_CONFIG.botUsername` in `app.js` or load `/api/config` before creating referral links.

## Important: demo vs production
- The browser game and points are demo-only. Demo game round rewards update in local page state and are not persistent.
- Real rewards are intentionally disabled in the API. `/api/game/claim`, `/api/ads/claim`, `/api/daily/claim`, and `/api/referrals/claim` return HTTP 501 until secure verification is implemented.
- Do not launch with real-money or redeemable points until the server verifies every reward, prevents duplicate claims, applies rate limits, and logs transactions.
- Telegram identity must be validated on the backend from raw `Telegram.WebApp.initData`. Do not trust `initDataUnsafe` as authentication.
- Rewarded ads require provider-specific server-to-server callback/signature verification. An ad button click is not proof that an ad was completed.
- Referrals should use Telegram `startapp` payloads, server-side attribution, self-referral protection, and one-time rewards.
- Configure Firebase Firestore security rules to deny direct client writes to balances and reward transactions. The server should own all point mutations.

## Suggested Firestore model
- `users/{telegramId}`: profile fields and balance
- `transactions/{transactionId}`: immutable credit/debit ledger; unique provider event ID
- `roundSessions/{sessionId}`: server-issued game session, expiry, validated outcome
- `adEvents/{providerEventId}`: unique provider callback record
- `referrals/{newUserTelegramId}`: inviter, status, creditedAt

## Next steps before public launch
1. Pick an ad provider and its official reward verification docs.
2. Implement a server-side game session / anti-cheat approach. For an arcade game, client-reported hits alone can be forged.
3. Set actual task reward values and daily limits.
4. Add admin dashboard with role-based access, audit logs and configurable reward settings.
5. Test Telegram Android/iOS safe areas, low-end devices, and provider ad callbacks.

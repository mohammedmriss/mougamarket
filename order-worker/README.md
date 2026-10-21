# MougaMarket orders setup

The storefront is static on GitHub Pages. This Worker keeps Telegram and Sheets credentials off the public site; Google Sheets is the order record used by the admin panel.

## 1. Publish the Google Apps Script endpoint

1. Create a Google spreadsheet for orders and copy its spreadsheet ID from the URL.
2. Open **Extensions → Apps Script** and paste `Code.gs`.
3. In **Project Settings → Script Properties**, add:
   - `SPREADSHEET_ID`: the spreadsheet ID.
   - `WORKER_SHARED_SECRET`: a long random secret.
4. Run any function once in the editor and approve the requested spreadsheet permissions.
5. Choose **Deploy → New deployment → Web app**. Set **Execute as: Me** and **Who has access: Anyone**. The script checks the shared secret on every request.
6. Copy the deployed Web app URL.

## 2. Deploy the Cloudflare Worker

Install Wrangler if needed, then run these commands from the repository root:

```text
npx wrangler login
npx wrangler secret put TELEGRAM_BOT_TOKEN --config order-worker/wrangler.toml
npx wrangler secret put TELEGRAM_CHAT_ID --config order-worker/wrangler.toml
npx wrangler secret put ADMIN_API_KEY --config order-worker/wrangler.toml
npx wrangler secret put SHEETS_WEBHOOK_SECRET --config order-worker/wrangler.toml
npx wrangler secret put SHEETS_WEB_APP_URL --config order-worker/wrangler.toml
npx wrangler deploy --config order-worker/wrangler.toml
```

Use the same random value for `SHEETS_WEBHOOK_SECRET` and the Apps Script `WORKER_SHARED_SECRET`. Keep `ADMIN_API_KEY` separate and private. Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` from BotFather and your Telegram chat. Enter secret values only when Wrangler prompts; never put them in source files.

`ALLOWED_ORIGINS` in `wrangler.toml` lists the permitted storefront origins. Update it to include the exact `https://` origin(s) you use, without a path or trailing slash. The default allows `https://mougamarket.store` and `https://www.mougamarket.store`.

## 3. Connect the store and admin panel

1. Copy the deployed Worker URL into `order_endpoint` in `data/config.json`, then commit and push the change.
2. Publish the repository using **GitHub → Settings → Pages**. Configure the custom domain `mougamarket.store` there if it is not already connected.
3. Visit `/admin.html`. Enter the GitHub `owner/repository`, branch, a fine-grained GitHub token with **Contents: Read and write** access to that repository, the Worker URL, and `ADMIN_API_KEY`.
4. Use the product editor to manage products; the settings screen changes `data/config.json`. Orders are listed from Sheets and their status is updated there.

The GitHub token and admin key are held in JavaScript memory for the current tab only. The storefront never receives either credential. As with any static page, anyone can open the admin page, but without the GitHub token and admin key they cannot modify the repository or retrieve orders.

## Product fields

Products in `data/products.json` support `id`, `name`, `category`, `price`, `stock`, `status` (`active` or `draft`), `badge`, `images`, `sizes`, `colors`, `image` (legacy fallback), and `description`. Draft products are not displayed in the storefront.

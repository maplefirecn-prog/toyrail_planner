async function main() {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch (error) {
    throw new Error("Playwright is not available. Install it only if you want to run this optional smoke test.");
  }

  const url = process.argv[2] || "http://127.0.0.1:8765/";
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  const errors = [];

  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.route("https://unpkg.com/**", (route) => route.abort());
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
  await page.waitForSelector("#pieceLibrary .piece-card", { timeout: 10000 });
  await page.waitForFunction(() => {
    const plan = document.getElementById("planCanvas");
    const view = document.getElementById("viewCanvas");
    return plan && view && plan.width > 0 && view.width > 0;
  }, null, { timeout: 10000 });

  const status = await page.locator("#storageStatus").innerText();
  const pieceCount = await page.locator("#pieceCount").innerText();
  await browser.close();

  if (errors.length) {
    throw new Error(errors.join("\n"));
  }
  console.log(`Smoke test passed. ${status} Pieces: ${pieceCount}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

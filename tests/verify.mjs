import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const context = vm.createContext({ window: {} });

vm.runInContext(read("data.js"), context, { filename: "data.js" });
vm.runInContext(read("cloud-config.js"), context, { filename: "cloud-config.js" });

const tasks = context.window.DEFAULT_TASKS;
const trackerConfig = context.window.TRACKER_CONFIG;
assert.equal(tasks.length, 22, "The default tracker must contain exactly 22 tasks.");
assert.equal(tasks.filter((task) => task.completed).length, 4, "Exactly four default tasks must start completed.");
assert.equal(new Set(tasks.map((task) => task.id)).size, 22, "Every task id must be unique.");
assert.equal(trackerConfig.schedules.length, 4, "The tracker must contain four schedule groups.");
tasks.forEach((task) => assert.ok(
  trackerConfig.schedules.some((schedule) => schedule.id === task.schedule),
  `Unknown schedule on task ${task.id}`,
));

const html = read("index.html");
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(new Set(ids).size, ids.length, "HTML element ids must be unique.");
[
  "taskGroups",
  "accountButton",
  "authDialog",
  "downloadPngButton",
  "downloadJpgButton",
  "supabase-setup.sql",
].forEach((required) => {
  if (required.endsWith(".sql")) assert.ok(fs.existsSync(new URL(`../${required}`, import.meta.url)), `${required} is missing.`);
  else assert.ok(html.includes(`id="${required}"`), `Missing #${required} in index.html.`);
});

const app = read("app.js");
assert.ok(app.includes("Synced to all devices"), "Cloud sync status is missing.");
assert.ok(app.includes("createTaskCardCanvas"), "Task-card export is missing.");
assert.ok(app.includes("postgres_changes"), "Realtime refresh is missing.");
assert.ok(app.includes("SYNC_META_KEY"), "Offline cloud-sync recovery is missing.");
assert.ok(app.includes("getSupabaseProjectUrl"), "Supabase URL normalization is missing.");

const cloudConfig = context.window.CLOUD_CONFIG;
assert.equal(cloudConfig.supabaseUrl, "https://lfdetzrwmtvahezwiniz.supabase.co", "Supabase must use the project base URL.");
assert.ok(!cloudConfig.supabaseUrl.includes("/rest/v1"), "Do not use the REST endpoint as the Supabase project URL.");
assert.ok(cloudConfig.supabaseAnonKey.startsWith("sb_publishable_"), "A browser-safe Supabase publishable key is required.");

const removedCopy = ["A strong start", "keep the momentum going."].join("—");
for (const file of ["index.html", "app.js", "data.js", "styles.css"]) {
  assert.ok(!read(file).includes(removedCopy), `${removedCopy} must not appear in ${file}.`);
}

console.log("Verified: 22 tasks, 4 completed, configured cloud sync, realtime refresh, and PNG/JPG exports.");

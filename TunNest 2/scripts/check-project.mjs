import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { spawnSync } from "node:child_process";
import { parse as parseYaml } from "yaml";

const root = new URL("..", import.meta.url).pathname;
const errors = [];
const warnings = [];

for (const file of ["extension/manifest.json", "product.config.json", "package.json"]) {
  try { JSON.parse(readFileSync(join(root, file), "utf8")); }
  catch (error) { errors.push(`${file}: ${error.message}`); }
}

for (const file of walk(join(root, ".github")).filter((file) => [".yml", ".yaml"].includes(extname(file)))) {
  try { parseYaml(readFileSync(file, "utf8")); }
  catch (error) { errors.push(`${file}: ${error.message}`); }
}

const manifest = JSON.parse(readFileSync(join(root, "extension/manifest.json"), "utf8"));
for (const icon of Object.values(manifest.icons || {})) if (!existsSync(join(root, "extension", icon))) errors.push(`缺少图标 ${icon}`);
if (!existsSync(join(root, "extension/fonts/NotoSansSC-UI.ttf"))) errors.push("缺少 Noto Sans SC UI 字体");

for (const file of walk(root).filter((file) => [".js", ".mjs"].includes(extname(file)))) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) errors.push(`${file}: ${result.stderr.trim()}`);
}

const clientConfig = ["extension/config.js", "product.config.json"].map((file) => readFileSync(join(root, file), "utf8")).join("\n");
if (/licensePublicJwk|BEGIN PRIVATE KEY|privateJwk/i.test(clientConfig)) errors.push("扩展配置中不应内置许可证公钥或私钥");
if (clientConfig.includes("example.workers.dev")) warnings.push("部署前请替换许可证 Worker 示例域名");
if (clientConfig.includes("example.com/buy")) warnings.push("发布前请替换购买链接");

for (const warning of warnings) console.warn(`WARN ${warning}`);
if (errors.length) {
  for (const error of errors) console.error(`ERROR ${error}`);
  process.exit(1);
}
console.log(`Project check passed · ${walk(root).length} files · ${warnings.length} configuration warnings`);

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (["node_modules", "dist", ".git"].includes(entry.name)) return [];
    return entry.isDirectory() ? walk(path) : [path];
  });
}

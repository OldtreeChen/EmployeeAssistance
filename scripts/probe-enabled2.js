"use strict";
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const https = require("https");
const { decrypt } = require("../lib/crypto");
const db = require("../lib/db");
const HOST = "econtact.ai3.cloud";
function post(p, b, j) {
  return new Promise((res, rej) => {
    const d = JSON.stringify(b);
    https.request({ hostname: HOST, path: p, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(d), ...(j?{Cookie:j}:{}) }
    }, r => {
      let raw = ""; r.on("data", c => raw += c);
      r.on("end", () => { const ck = (r.headers["set-cookie"]||[]).map(c=>c.split(";")[0]).join("; ");
        try { res({ data: JSON.parse(raw), jar: ck }); } catch { res({ data: raw, jar: ck }); }
      });
    }).on("error", rej).end(d);
  });
}
const USER_LIST = "5be1aa3f-3472-4ccb-8c7f-424d1c913586";
async function main() {
  await db.init();
  const [u] = await db.query("SELECT ec_username,ec_password FROM users WHERE ec_username=?", ["oldtree.chen"]);
  const jar = (await post("/ecp/Qs.OnlineUser.login.data", { loginName:u.ec_username, password:decrypt(u.ec_password), language:"zh-tw" })).jar;

  // Test: query ALL users (no dept filter) with FEnabled=false — should find disabled users company-wide
  const rFalse = await post("/ecp/qsvd-list/Qs.User.getListData.data", {
    listId: USER_LIST,
    conditions: [{ fieldName: "FEnabled", value: false, operator: "Equal" }],
    pageSize: 20
  }, jar);
  const disabled = rFalse.data?.data?.records || [];
  console.log("Company-wide disabled users:", disabled.length);
  disabled.forEach(u => console.log(" -", u.FName, u.FDepartmentId));

  // Test with true
  const rTrue = await post("/ecp/qsvd-list/Qs.User.getListData.data", {
    listId: USER_LIST,
    conditions: [{ fieldName: "FEnabled", value: true, operator: "Equal" }],
    pageSize: 5
  }, jar);
  console.log("Enabled (first 5):", (rTrue.data?.data?.records||[]).map(u=>u.FName));
  console.log("Total enabled (total field):", rTrue.data?.data?.total);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });

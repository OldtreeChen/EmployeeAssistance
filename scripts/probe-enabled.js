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
const DEPT_ID   = "ffffff19-b876-ec3a-3007-b725383cf204"; // 智能應用事業群

async function queryDeptUsers(jar, deptId, enabled) {
  const conditions = [{ fieldName: "FDepartmentId", value: deptId, operator: "Equal" }];
  if (enabled !== undefined) conditions.push({ fieldName: "FEnabled", value: enabled, operator: "Equal" });
  const r = await post("/ecp/qsvd-list/Qs.User.getListData.data", {
    listId: USER_LIST, conditions, pageSize: 100
  }, jar);
  return r.data?.data?.records || [];
}

async function main() {
  await db.init();
  const [u] = await db.query("SELECT ec_username,ec_password FROM users WHERE ec_username=?", ["oldtree.chen"]);
  const jar = (await post("/ecp/Qs.OnlineUser.login.data", { loginName:u.ec_username, password:decrypt(u.ec_password), language:"zh-tw" })).jar;

  // Child depts
  const childRes = await post("/ecp/Qs.Department.getListData.data", {
    conditions: [{fieldName:"FParentId",value:DEPT_ID,operator:"Equal"}], pageSize:50
  }, jar);
  const childDepts = childRes.data?.data?.records || [];
  const allDeptIds = [DEPT_ID, ...childDepts.map(d=>d.FId)];
  console.log("Depts:", [DEPT_ID, ...childDepts.map(d=>d.FName)]);

  for (const did of allDeptIds) {
    const all     = await queryDeptUsers(jar, did, undefined);
    const enabled = await queryDeptUsers(jar, did, true);
    console.log(`\nDept ${did}: all=${all.length}, enabled=${enabled.length}`);
    const disabled = all.filter(u => !enabled.find(e=>e.FId===u.FId));
    if (disabled.length) console.log("  Disabled:", disabled.map(u=>u.FName));
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });

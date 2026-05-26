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
  const [u] = await db.query("SELECT ec_username,ec_password,employee_id FROM users WHERE ec_username=?", ["oldtree.chen"]);
  const jar = (await post("/ecp/Qs.OnlineUser.login.data", {loginName:u.ec_username,password:decrypt(u.ec_password),language:"zh-tw"})).jar;
  const ecUserId = u.employee_id;

  // Step 1: self lookup
  const selfRes = await post("/ecp/qsvd-list/Qs.User.getListData.data", {
    listId: USER_LIST, conditions: [{fieldName:"FId",value:ecUserId,operator:"Equal"}], pageSize:1
  }, jar);
  const self = selfRes.data?.data?.records?.[0];
  const deptId = self?.FDepartmentId || "";
  const deptName = self?.["FDepartmentId$"] || "";
  console.log("deptId:", deptId, "deptName:", deptName);

  // Step 2: child depts
  const childRes = await post("/ecp/Qs.Department.getListData.data", {
    conditions: [{fieldName:"FParentId",value:deptId,operator:"Equal"}], pageSize:50
  }, jar);
  const childDepts = childRes.data?.data?.records || [];
  console.log("Child depts:", childDepts.map(d => d.FName + " (" + d.FId + ")"));

  // Step 3: users in all related depts
  const allDepts = [deptId, ...childDepts.map(d=>d.FId)];
  const seen = new Set([ecUserId]);
  const deputies = [];
  for (const did of allDepts) {
    const r = await post("/ecp/qsvd-list/Qs.User.getListData.data", {
      listId: USER_LIST, conditions: [{fieldName:"FDepartmentId",value:did,operator:"Equal"}], pageSize:100
    }, jar);
    for (const usr of (r.data?.data?.records||[])) {
      if (!seen.has(usr.FId)) { seen.add(usr.FId); deputies.push(usr.FName); }
    }
  }
  console.log("Deputies (" + deputies.length + "):", deputies);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });

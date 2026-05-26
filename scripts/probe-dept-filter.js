require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const https = require("https");
const { decrypt } = require("../lib/crypto");
const db = require("../lib/db");
const HOST = "econtact.ai3.cloud";
function post(path, body, jar) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    https.request({ hostname: HOST, path, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data), ...(jar ? { Cookie: jar } : {}) }
    }, res => {
      let raw = ""; res.on("data", c => raw += c);
      res.on("end", () => { const cookie = (res.headers["set-cookie"]||[]).map(c=>c.split(";")[0]).join("; ");
        try { resolve({ data: JSON.parse(raw), jar: cookie }); } catch { resolve({ data: raw, jar: cookie }); } });
    }).on("error", reject).end(data);
  });
}
const LIST_ID = "5be1aa3f-3472-4ccb-8c7f-424d1c913586";
const KNOWN_DEPT = "ffffff19-b876-ec3a-3007-b725383cf204";
async function main() {
  await db.init();
  const [user] = await db.query("SELECT ec_username, ec_password, employee_id FROM users WHERE ec_username=?", ["oldtree.chen"]);
  const jar = (await post("/ecp/Qs.OnlineUser.login.data", { loginName: user.ec_username, password: decrypt(user.ec_password), language: "zh-tw" })).jar;
  console.log("Login OK");
  
  const r = await post("/ecp/qsvd-list/Qs.User.getListData.data", {
    listId: LIST_ID, conditions: [{ fieldName: "FDepartmentId", value: KNOWN_DEPT, operator: "Equal" }], pageSize: 50
  }, jar);
  const recs = r.data?.data?.records || [];
  console.log("Same-dept users:", recs.length);
  recs.forEach(u => console.log(" -", u.FName, "("+u.FId+")"));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });

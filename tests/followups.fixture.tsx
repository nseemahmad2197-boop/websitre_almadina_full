import React, { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { AppContext, type AppContextValue } from "../app/lib/app-context";
import { createSeedDatabase, type Database, type Order } from "../app/lib/data";
import { ParcelFollowups, FollowupsPage } from "../app/components/followups";
const database = createSeedDatabase();
database.users = [{id:"owner", role:"merchant",name:"تاجر تجريبي"},{id:"admin",role:"admin",name:"المتابعة"},{id:"other",role:"merchant",name:"حساب آخر"}] as Database["users"];
database.orders = [{id:"parcel-1",trackingNumber:"ALX-TEST-001",merchantId:"owner",recipientName:"مستلم تجريبي",deleted:false}] as Order[];
function Fixture() {
 const [account,setAccount]=useState("owner"),[page,setPage]=useState("parcel");
 const context={database,user:database.users.find(u=>u.id===account),showToast:()=>{},setSelectedOrderId:()=>{},setView:()=>setPage("parcel")} as unknown as AppContextValue;
 return <AppContext.Provider value={context}><main className="page-content" dir="rtl"><h1>متابعة الطرد — معاينة محلية</h1><nav><button id="owner" onClick={()=>setAccount("owner")}>التاجر</button><button id="admin" onClick={()=>setAccount("admin")}>الإدارة</button><button id="other" onClick={()=>setAccount("other")}>تبديل الحساب</button><button id="inbox" onClick={()=>setPage("inbox")}>قائمة المتابعات</button></nav>{page==="inbox"?<FollowupsPage/>:<ParcelFollowups order={database.orders[0]}/>}</main></AppContext.Provider>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><Fixture/></StrictMode>);

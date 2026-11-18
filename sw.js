/* =========================
   DenaPaona - Service Worker
   Handles PWA & Notification Bar Actions (OK / Reject)
========================= */

self.addEventListener("install", (event) => {
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil(self.clients.claim());
});

// মোবাইলের নোটিফিকেশন বারের OK বা Reject বাটনে ক্লিক করলে যা হবে
self.addEventListener("notificationclick", (event) => {
    const notification = event.notification;
    const action = event.action; // 'accept' অথবা 'reject'
    const reqId = notification.data ? notification.data.reqId : null;

    notification.close();

    event.waitUntil(
        self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
            // খোলা থাকা অ্যাপ উইন্ডোতে মেসেজ পাঠানো যাতে সাথে সাথে OK/Reject আপডেট হয়
            for (const client of clientList) {
                if (reqId && (action === "accept" || action === "reject")) {
                    client.postMessage({
                        type: "NOTIF_ACTION",
                        reqId: reqId,
                        status: action === "accept" ? "accepted" : "rejected"
                    });
                }
                return client.focus();
            }
            // যদি অ্যাপ মিনিমাইজ থাকে তবে অ্যাপ ওপেন করা
            if (self.clients.openWindow) {
                return self.clients.openWindow("/");
            }
        })
    );
});
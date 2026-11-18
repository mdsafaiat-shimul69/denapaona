/* =========================
   DenaPaona - Full App Logic
   Personal DenaPaona + Group Tour Cost Sheet Manager
========================= */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
    getAuth,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    updateProfile
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
    getFirestore,
    doc,
    setDoc,
    getDoc,
    addDoc,
    updateDoc,
    deleteDoc,
    collection,
    query,
    where,
    getDocs,
    onSnapshot,
    arrayUnion,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

// Firebase Configuration
const firebaseConfig = {
    apiKey: "AIzaSyBkHhVwMNH-1SYh1NNRV5LOoNRGSquK-mo",
    authDomain: "denapaona-5dd8b.firebaseapp.com",
    projectId: "denapaona-5dd8b",
    storageBucket: "denapaona-5dd8b.firebasestorage.app",
    messagingSenderId: "39186342180",
    appId: "1:39186342180:web:3ba4e688dede56ce4553b1"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Service Worker & Notification Setup
let swRegistration = null;
const notifiedIds = new Set();

if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").then((reg) => {
        swRegistration = reg;
    }).catch((err) => console.log("SW Error:", err));

    navigator.serviceWorker.addEventListener("message", (event) => {
        if (event.data && event.data.type === "NOTIF_ACTION") {
            window.respondToRequest(event.data.reqId, event.data.status);
        }
    });
}

async function requestMobileNotificationPermission() {
    if ("Notification" in window && Notification.permission === "default") {
        try {
            await Notification.requestPermission();
        } catch (e) {}
    }
}

function showBrowserNotification(id, title, body, withActions = false) {
    if (notifiedIds.has(id)) return;
    notifiedIds.add(id);

    if (!("Notification" in window) || Notification.permission !== "granted") return;

    if (swRegistration && swRegistration.showNotification) {
        const options = {
            body: body,
            tag: id,
            vibrate: [200, 100, 200],
            data: { reqId: id }
        };
        if (withActions) {
            options.actions = [
                { action: "accept", title: "✓ OK / Accept" },
                { action: "reject", title: "✕ Reject" }
            ];
        }
        swRegistration.showNotification(title, options);
    } else {
        new Notification(title, { body: body });
    }
}

// Global State
let currentUserData = null;
let connectedUsersMap = {};
let allTransactions = [];
let myTours = [];
let activeTourId = null;
let activeTourEntries = [];
let personalPendingDocs = [];
let tourNotifDocs = [];

// Listeners
let unsubscribeIncoming = null;
let unsubscribeSent = null;
let unsubscribeLedger = null;
let unsubscribeTours = null;
let unsubscribeTourEntries = null;
let unsubscribeTourNotifs = null;

// DOM Elements
const authSection = document.getElementById("authSection");
const appSection = document.getElementById("appSection");
const authForm = document.getElementById("authForm");
const authTitle = document.getElementById("authTitle");
const authSubtitle = document.getElementById("authSubtitle");
const authButton = document.getElementById("authButton");
const switchAuth = document.getElementById("switchAuth");
const switchText = document.getElementById("switchText");
const nameGroup = document.getElementById("nameGroup");

let isSignup = false;

function generateUserCode() {
    return `#DP-${Math.floor(1000 + Math.random() * 9000)}`;
}

function formatCurrency(amount) {
    return `৳ ${Number(amount).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(timestamp) {
    if (!timestamp) return "Just now";
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
    });
}

function isSettlementType(type) {
    return type === "ferot" || type === "ferot_diyechi" || type === "ferot_diyeche";
}

// Top Bell Dropdown Toggle
const topBellBtn = document.getElementById("topBellBtn");
const notifDropdown = document.getElementById("notifDropdown");

topBellBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    notifDropdown.hidden = !notifDropdown.hidden;
});

document.getElementById("viewAllNotifsBtn").addEventListener("click", () => {
    notifDropdown.hidden = true;
});

document.addEventListener("click", (e) => {
    if (!notifDropdown.hidden && !notifDropdown.contains(e.target) && !topBellBtn.contains(e.target)) {
        notifDropdown.hidden = true;
    }
});

// LOGIN / SIGNUP SWITCH
switchAuth.addEventListener("click", () => {
    isSignup = !isSignup;
    if (isSignup) {
        authTitle.textContent = "Create Account";
        authSubtitle.textContent = "Join DenaPaona and manage your money & tour records.";
        authButton.textContent = "Create My Account";
        switchText.textContent = "Already have an account?";
        switchAuth.textContent = "Login";
        nameGroup.hidden = false;
        document.getElementById("fullName").required = true;
    } else {
        authTitle.textContent = "Welcome Back!";
        authSubtitle.textContent = "Login to manage your money & tour records.";
        authButton.textContent = "Login to Account";
        switchText.textContent = "Don't have an account?";
        switchAuth.textContent = "Sign Up";
        nameGroup.hidden = true;
        document.getElementById("fullName").required = false;
    }
});

// FIREBASE LOGIN / SIGNUP
authForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = document.getElementById("email").value.trim().toLowerCase();
    const password = document.getElementById("password").value;
    const name = document.getElementById("fullName").value.trim();

    authButton.disabled = true;
    authButton.textContent = isSignup ? "Creating Account..." : "Logging in...";

    try {
        if (isSignup) {
            if (!name) {
                alert("Please enter your full name.");
                return;
            }
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;
            await updateProfile(user, { displayName: name });

            await setDoc(doc(db, "users", user.uid), {
                uid: user.uid,
                name: name,
                email: email,
                userCode: generateUserCode(),
                connections: [],
                createdAt: serverTimestamp()
            });
        } else {
            await signInWithEmailAndPassword(auth, email, password);
        }
        authForm.reset();
        await requestMobileNotificationPermission();
    } catch (error) {
        alert("Error: " + error.message);
    } finally {
        authButton.disabled = false;
        authButton.textContent = isSignup ? "Create My Account" : "Login to Account";
    }
});

// AUTH STATE LISTENER
onAuthStateChanged(auth, async (user) => {
    if (user) {
        const userDocRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userDocRef);

        if (userSnap.exists()) {
            currentUserData = userSnap.data();
        } else {
            currentUserData = {
                uid: user.uid,
                name: user.displayName || user.email.split("@")[0],
                email: user.email,
                userCode: generateUserCode(),
                connections: []
            };
            await setDoc(userDocRef, currentUserData);
        }

        openDashboard(currentUserData);
        requestMobileNotificationPermission();
        await loadConnections();
        startRealtimeListeners();
    } else {
        cleanupListeners();
        currentUserData = null;
        appSection.hidden = true;
        authSection.hidden = false;
    }
});

function cleanupListeners() {
    if (unsubscribeIncoming) unsubscribeIncoming();
    if (unsubscribeSent) unsubscribeSent();
    if (unsubscribeLedger) unsubscribeLedger();
    if (unsubscribeTours) unsubscribeTours();
    if (unsubscribeTourEntries) unsubscribeTourEntries();
    if (unsubscribeTourNotifs) unsubscribeTourNotifs();
}

function openDashboard(userData) {
    authSection.hidden = true;
    appSection.hidden = false;

    const { name, email, userCode } = userData;
    document.getElementById("userName").textContent = name;
    document.getElementById("userAvatar").textContent = name.charAt(0).toUpperCase();
    document.getElementById("profileName").textContent = name;
    document.getElementById("profileEmail").textContent = email;
    document.getElementById("profileAvatar").textContent = name.charAt(0).toUpperCase();

    const profileIdBox = document.querySelector(".profile-id");
    if (profileIdBox) {
        profileIdBox.innerHTML = `Unique User ID: <strong>${userCode}</strong>`;
    }

    showPage("dashboard");
    if (window.lucide) lucide.createIcons();
}

// ==========================================
// CONNECTIONS SEARCH & LOAD
// ==========================================
const searchUserForm = document.getElementById("searchUserForm");
const searchUserBtn = document.getElementById("searchUserBtn");

searchUserForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentUserData) return;

    const rawInput = document.getElementById("searchQuery").value.trim();
    if (!rawInput) return;

    searchUserBtn.disabled = true;
    searchUserBtn.textContent = "Searching...";

    try {
        const usersRef = collection(db, "users");
        let q = rawInput.includes("@")
            ? query(usersRef, where("email", "==", rawInput.toLowerCase()))
            : query(usersRef, where("userCode", "==", rawInput.toUpperCase().startsWith("#") ? rawInput.toUpperCase() : `#${rawInput.toUpperCase()}`));

        const querySnapshot = await getDocs(q);
        if (querySnapshot.empty) {
            alert("কোনো User পাওয়া যায়নি! সঠিক Email অথবা #DP-XXXX কোড দিন।");
            return;
        }

        let foundUser = null;
        querySnapshot.forEach((docSnap) => { foundUser = docSnap.data(); });

        if (foundUser.uid === currentUserData.uid) {
            alert("আপনি নিজের অ্যাকাউন্ট নিজেকে Add করতে পারবেন না!");
            return;
        }

        const existingConnections = currentUserData.connections || [];
        if (existingConnections.includes(foundUser.uid)) {
            alert(`${foundUser.name} আগেই আপনার সাথে Connected আছেন!`);
            return;
        }

        await setDoc(doc(db, "users", currentUserData.uid), { connections: arrayUnion(foundUser.uid) }, { merge: true });
        await setDoc(doc(db, "users", foundUser.uid), { connections: arrayUnion(currentUserData.uid) }, { merge: true });

        if (!currentUserData.connections) currentUserData.connections = [];
        currentUserData.connections.push(foundUser.uid);

        alert(`সফলভাবে ${foundUser.name} (${foundUser.userCode})-এর সাথে যুক্ত হয়েছেন!`);
        searchUserForm.reset();
        await loadConnections();
    } catch (error) {
        alert("Error: " + error.message);
    } finally {
        searchUserBtn.disabled = false;
        searchUserBtn.innerHTML = `<i data-lucide="search"></i> Search & Connect`;
        if (window.lucide) lucide.createIcons();
    }
});

async function loadConnections() {
    const listContainer = document.getElementById("connectionsList");
    const receiverSelect = document.getElementById("requestReceiverSelect");
    const filterSelect = document.getElementById("ledgerFilterSelect");

    const freshSnap = await getDoc(doc(db, "users", currentUserData.uid));
    if (freshSnap.exists()) currentUserData = freshSnap.data();

    const connections = currentUserData.connections || [];
    connectedUsersMap = {};

    receiverSelect.innerHTML = `<option value="">-- Choose a person --</option>`;
    filterSelect.innerHTML = `<option value="all">All Connected Users</option>`;

    if (connections.length === 0) return;

    let html = "";
    for (const friendUid of connections) {
        const friendSnap = await getDoc(doc(db, "users", friendUid));
        if (friendSnap.exists()) {
            const friend = friendSnap.data();
            connectedUsersMap[friendUid] = friend;

            html += `
                <div class="connection-item">
                    <div class="connection-left">
                        <div class="avatar">${friend.name.charAt(0).toUpperCase()}</div>
                        <div class="connection-info">
                            <h4>${friend.name}</h4>
                            <p>${friend.email}</p>
                        </div>
                    </div>
                    <span class="code-pill">${friend.userCode}</span>
                </div>
            `;

            receiverSelect.innerHTML += `<option value="${friend.uid}">${friend.name} (${friend.userCode})</option>`;
            filterSelect.innerHTML += `<option value="${friend.uid}">${friend.name}</option>`;
        }
    }
    listContainer.innerHTML = html;
}

// ==========================================
// PERSONAL MONEY RECORD (4 OPTIONS)
// ==========================================
const requestModal = document.getElementById("requestModal");
const sendRequestForm = document.getElementById("sendRequestForm");
const submitRequestBtn = document.getElementById("submitRequestBtn");

document.getElementById("addRequestBtn").addEventListener("click", async () => {
    await loadConnections();
    if (!currentUserData.connections || currentUserData.connections.length === 0) {
        alert("আগে Connections পেজ থেকে কাউকে Add করুন, তারপর হিসাব পাঠাতে পারবেন!");
        showPage("connections");
        return;
    }
    requestModal.hidden = false;
});

document.getElementById("closeRequestModal").addEventListener("click", () => { requestModal.hidden = true; });
document.getElementById("cancelRequestBtn").addEventListener("click", () => { requestModal.hidden = true; });

sendRequestForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentUserData) return;

    const txType = document.querySelector('input[name="txType"]:checked').value;
    const otherUserId = document.getElementById("requestReceiverSelect").value;
    const amount = parseFloat(document.getElementById("requestAmount").value);
    const description = document.getElementById("requestDescription").value.trim();

    if (!otherUserId || isNaN(amount) || amount <= 0 || !description) {
        alert("সবগুলো ঘর সঠিকভাবে পূরণ করুন।");
        return;
    }

    const otherUser = connectedUsersMap[otherUserId];
    const otherUserName = otherUser ? otherUser.name : "User";

    const isMyPlus = (txType === "paona" || txType === "ferot_diyechi");
    const creditorId = isMyPlus ? currentUserData.uid : otherUserId;
    const creditorName = isMyPlus ? currentUserData.name : otherUserName;
    const debtorId = isMyPlus ? otherUserId : currentUserData.uid;
    const debtorName = isMyPlus ? otherUserName : currentUserData.name;

    submitRequestBtn.disabled = true;
    submitRequestBtn.textContent = "Sending...";

    try {
        await addDoc(collection(db, "requests"), {
            type: txType,
            senderId: currentUserData.uid,
            senderName: currentUserData.name,
            senderCode: currentUserData.userCode,
            receiverId: otherUserId,
            receiverName: otherUserName,
            creditorId, creditorName, debtorId, debtorName,
            participants: [currentUserData.uid, otherUserId],
            amount, description,
            status: "pending",
            createdAt: serverTimestamp()
        });

        alert("নোটিফিকেশন পাঠানো হয়েছে! অপর ব্যক্তি OK করলেই Cost Sheet-এ যুক্ত হবে।");
        sendRequestForm.reset();
        requestModal.hidden = true;
    } catch (error) {
        alert("Error: " + error.message);
    } finally {
        submitRequestBtn.disabled = false;
        submitRequestBtn.textContent = "Send Notification";
    }
});

// ==========================================
// REAL-TIME LISTENERS (PERSONAL + TOUR)
// ==========================================
function startRealtimeListeners() {
    cleanupListeners();
    const uid = currentUserData.uid;

    // ১. Incoming Personal Requests
    const incomingQuery = query(
        collection(db, "requests"),
        where("receiverId", "==", uid),
        where("status", "==", "pending")
    );

    unsubscribeIncoming = onSnapshot(incomingQuery, (snapshot) => {
        personalPendingDocs = [];
        snapshot.forEach((docSnap) => {
            const req = docSnap.data();
            personalPendingDocs.push({ id: docSnap.id, ...req });
            showBrowserNotification(
                docSnap.id,
                `${req.senderName} - DenaPaona`,
                `৳${req.amount} (${req.description})`,
                true
            );
        });
        renderIncomingPersonalRequests();
        updateNotificationBadgesAndDropdown();
    });

    // ২. Sent Personal Requests
    const sentQuery = query(
        collection(db, "requests"),
        where("senderId", "==", uid),
        where("status", "==", "pending")
    );

    unsubscribeSent = onSnapshot(sentQuery, (snapshot) => {
        const container = document.getElementById("sentRequestsList");
        if (snapshot.empty) {
            container.innerHTML = `<p style="color: var(--muted); font-size: 13px;">No pending sent requests.</p>`;
            return;
        }
        let html = "";
        snapshot.forEach((docSnap) => {
            const req = docSnap.data();
            let typeLabel = req.type === "dena"
                ? `আপনি <strong>${req.receiverName}</strong>-কে জানিয়েছেন সে আপনার কাছে পাবে`
                : req.type === "ferot_diyechi"
                ? `আপনি <strong>${req.receiverName}</strong>-কে টাকা ফেরত দিয়েছেন (OK বাকি)`
                : req.type === "ferot_diyeche"
                ? `আপনি <strong>${req.receiverName}</strong>-কে জানিয়েছেন সে আপনাকে ফেরত দিয়েছে (OK বাকি)`
                : `আপনি <strong>${req.receiverName}</strong>-এর কাছে পাওনা চেয়েছেন`;

            html += `
                <div class="request-card">
                    <div class="req-info">
                        <h4>${typeLabel}</h4>
                        <p>বিবরণ: ${req.description} • Status: <span style="color:#fbbf24;">Waiting for OK</span></p>
                        <div class="req-amount">${formatCurrency(req.amount)}</div>
                    </div>
                </div>
            `;
        });
        container.innerHTML = html;
    });

    // ৩. Personal Accepted Ledger
    const ledgerQuery = query(
        collection(db, "requests"),
        where("participants", "array-contains", uid),
        where("status", "==", "accepted")
    );

    unsubscribeLedger = onSnapshot(ledgerQuery, (snapshot) => {
        allTransactions = [];
        snapshot.forEach((docSnap) => {
            allTransactions.push({ id: docSnap.id, ...docSnap.data() });
        });
        allTransactions.sort((a, b) => (b.acceptedAt?.toMillis?.() || 0) - (a.acceptedAt?.toMillis?.() || 0));
        updateBalancesAndUI();
    });

    // ৪. My Group Tours Listener
    const toursQuery = query(
        collection(db, "tours"),
        where("memberIds", "array-contains", uid)
    );

    unsubscribeTours = onSnapshot(toursQuery, (snapshot) => {
        myTours = [];
        snapshot.forEach((docSnap) => {
            myTours.push({ id: docSnap.id, ...docSnap.data() });
        });
        myTours.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));

        const tourBadge = document.getElementById("sideTourBadge");
        if (myTours.length > 0) {
            tourBadge.textContent = myTours.length;
            tourBadge.hidden = false;
        } else {
            tourBadge.hidden = true;
        }

        renderToursList();
        if (activeTourId) {
            const currentTour = myTours.find(t => t.id === activeTourId);
            if (currentTour) renderTourDetailHeaderAndSummary(currentTour);
        }
    });

    // ৫. Group Tour Notifications Listener
    const tourNotifsQuery = query(
        collection(db, "tour_notifications"),
        where("recipientIds", "array-contains", uid)
    );

    unsubscribeTourNotifs = onSnapshot(tourNotifsQuery, (snapshot) => {
        tourNotifDocs = [];
        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            if (data.actorId !== uid) {
                tourNotifDocs.push({ id: docSnap.id, ...data });
                showBrowserNotification(docSnap.id, data.title, data.message, false);
            }
        });
        tourNotifDocs.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
        renderTourNotifications();
        updateNotificationBadgesAndDropdown();
    });
}
function updateNotificationBadgesAndDropdown() {
    const totalCount = personalPendingDocs.length + tourNotifDocs.length;
    const sideBadge = document.getElementById("sideNotifBadge");
    const mobileBadge = document.getElementById("mobileNotifBadge");
    const topDot = document.getElementById("topNotifDot");
    const quickList = document.getElementById("quickNotifList");

    if (totalCount > 0) {
        sideBadge.textContent = totalCount;
        sideBadge.hidden = false;
        mobileBadge.textContent = totalCount;
        mobileBadge.hidden = false;
        topDot.hidden = false;
    } else {
        sideBadge.hidden = true;
        mobileBadge.hidden = true;
        topDot.hidden = true;
    }

    if (totalCount === 0) {
        quickList.innerHTML = `<p class="empty-drop">No new notifications</p>`;
        return;
    }

    let qHtml = "";
    personalPendingDocs.forEach((req) => {
        qHtml += `
            <div class="drop-item">
                <p><strong>${req.senderName}</strong>: ${req.description}</p>
                <div class="drop-amt">${formatCurrency(req.amount)}</div>
                <div class="drop-actions">
                    <button class="btn-ok" onclick="respondToRequest('${req.id}', 'accepted')">✓ OK</button>
                    <button class="btn-reject" onclick="respondToRequest('${req.id}', 'rejected')">✕ Reject</button>
                </div>
            </div>
        `;
    });

    tourNotifDocs.slice(0, 5).forEach((tn) => {
        qHtml += `
            <div class="drop-item" style="cursor:pointer;" onclick="openTourFromNotif('${tn.tourId}')">
                <p style="color:#a5b4fc; font-weight:700;">🧭 ${tn.title}</p>
                <p style="margin-top:3px;">${tn.message}</p>
            </div>
        `;
    });

    quickList.innerHTML = qHtml;
}

window.openTourFromNotif = function (tourId) {
    notifDropdown.hidden = true;
    showPage("tours");
    openTourPortal(tourId);
};

function renderIncomingPersonalRequests() {
    const container = document.getElementById("incomingRequestsList");
    if (personalPendingDocs.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon"><i data-lucide="bell-ring"></i></div>
                <h3>No New Personal Requests</h3>
                <p>You are all caught up!</p>
            </div>
        `;
        if (window.lucide) lucide.createIcons();
        return;
    }

    let html = "";
    personalPendingDocs.forEach((req) => {
        let headline = req.type === "dena"
            ? `<strong>${req.senderName}</strong> জানিয়েছেন <strong>আপনি তার কাছে টাকা পাবেন</strong>`
            : req.type === "ferot_diyechi"
            ? `<strong>${req.senderName}</strong> আপনাকে <strong>টাকা ফেরত দিয়েছেন</strong> বলে জানিয়েছেন`
            : req.type === "ferot_diyeche"
            ? `<strong>${req.senderName}</strong> জানিয়েছেন <strong>আপনি তাকে টাকা ফেরত দিয়েছেন</strong>`
            : `<strong>${req.senderName}</strong> <strong>আপনার কাছে টাকা পাওনা</strong> দাবি করেছেন`;

        html += `
            <div class="request-card">
                <div class="req-info">
                    <h4>${headline}</h4>
                    <p>বিবরণ: ${req.description} • ${formatDate(req.createdAt)}</p>
                    <div class="req-amount">${formatCurrency(req.amount)}</div>
                </div>
                <div class="req-btns">
                    <button class="btn-ok" onclick="respondToRequest('${req.id}', 'accepted')">✓ OK / Accept</button>
                    <button class="btn-reject" onclick="respondToRequest('${req.id}', 'rejected')">✕ Reject</button>
                </div>
            </div>
        `;
    });
    container.innerHTML = html;
}

function renderTourNotifications() {
    const card = document.getElementById("tourNotificationsCard");
    const list = document.getElementById("tourNotificationsList");

    if (tourNotifDocs.length === 0) {
        card.hidden = true;
        return;
    }

    card.hidden = false;
    list.innerHTML = tourNotifDocs.map(tn => `
        <div class="request-card" style="cursor:pointer;" onclick="openTourFromNotif('${tn.tourId}')">
            <div class="req-info">
                <h4 style="color:#a5b4fc;">🧭 ${tn.title}</h4>
                <p>${tn.message} • ${formatDate(tn.createdAt)}</p>
            </div>
            <span class="code-pill">View Tour →</span>
        </div>
    `).join("");
}

document.getElementById("markTourNotifsReadBtn").addEventListener("click", async () => {
    const uid = currentUserData.uid;
    for (const tn of tourNotifDocs) {
        const updatedRecipients = (tn.recipientIds || []).filter(id => id !== uid);
        await updateDoc(doc(db, "tour_notifications", tn.id), { recipientIds: updatedRecipients });
    }
});

window.respondToRequest = async function (requestId, newStatus) {
    try {
        await updateDoc(doc(db, "requests", requestId), {
            status: newStatus,
            acceptedAt: serverTimestamp()
        });
    } catch (error) {
        alert("Error: " + error.message);
    }
};

// ==========================================
// GROUP TOUR COST SHEET SYSTEM
// ==========================================
window.closeTourModal = function (modalId) {
    document.getElementById(modalId).hidden = true;
};

document.getElementById("openCreateTourBtn").addEventListener("click", async () => {
    await loadConnections();
    const box = document.getElementById("tourMemberCheckboxes");
    const friends = Object.values(connectedUsersMap);

    if (friends.length === 0) {
        box.innerHTML = `<p style="color:#f87171; font-size:12px;">আগে Connections পেজ থেকে বন্ধুদের Add করুন, তারপর ট্যুর তৈরি করুন!</p>`;
    } else {
        box.innerHTML = friends.map(f => `
            <label class="member-check-item">
                <input type="checkbox" name="tourMembers" value="${f.uid}">
                <span><strong>${f.name}</strong> (${f.userCode})</span>
            </label>
        `).join("");
    }
    document.getElementById("createTourModal").hidden = false;
});

document.getElementById("createTourForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const tourName = document.getElementById("tourNameInput").value.trim();
    const checkedBoxes = document.querySelectorAll('input[name="tourMembers"]:checked');

    if (!tourName) return;

    const memberIds = [currentUserData.uid];
    const membersMap = {
        [currentUserData.uid]: {
            uid: currentUserData.uid,
            name: currentUserData.name,
            userCode: currentUserData.userCode
        }
    };

    checkedBoxes.forEach((cb) => {
        const fUid = cb.value;
        const friend = connectedUsersMap[fUid];
        if (friend) {
            memberIds.push(fUid);
            membersMap[fUid] = {
                uid: friend.uid,
                name: friend.name,
                userCode: friend.userCode
            };
        }
    });

    const btn = document.getElementById("submitCreateTourBtn");
    btn.disabled = true;
    btn.textContent = "Creating...";

    try {
        const tourDoc = await addDoc(collection(db, "tours"), {
            name: tourName,
            managerId: currentUserData.uid,
            managerName: currentUserData.name,
            memberIds: memberIds,
            members: membersMap,
            createdAt: serverTimestamp()
        });

        if (memberIds.length > 1) {
            await addDoc(collection(db, "tour_notifications"), {
                tourId: tourDoc.id,
                actorId: currentUserData.uid,
                recipientIds: memberIds.filter(id => id !== currentUserData.uid),
                title: `New Tour: ${tourName}`,
                message: `${currentUserData.name} (Manager) আপনাকে "${tourName}" ট্যুর কস্ট শিটে যুক্ত করেছেন।`,
                createdAt: serverTimestamp()
            });
        }

        document.getElementById("createTourForm").reset();
        closeTourModal("createTourModal");
        openTourPortal(tourDoc.id);
    } catch (error) {
        alert("Error: " + error.message);
    } finally {
        btn.disabled = false;
        btn.textContent = "Create Tour";
    }
});

function renderToursList() {
    const grid = document.getElementById("myToursGrid");
    if (myTours.length === 0) {
        grid.innerHTML = `
            <div class="content-card" style="grid-column: 1 / -1;">
                <div class="empty-state">
                    <div class="empty-icon"><i data-lucide="compass"></i></div>
                    <h3>No Group Tours Yet</h3>
                    <p>Click "Create a Tour Cost Sheet" to start a new tour ledger as Manager.</p>
                </div>
            </div>
        `;
        if (window.lucide) lucide.createIcons();
        return;
    }

    grid.innerHTML = myTours.map(tour => {
        const isManager = tour.managerId === currentUserData.uid;
        const memberCount = (tour.memberIds || []).length;
        return `
            <div class="tour-card" onclick="openTourPortal('${tour.id}')">
                <div class="tour-card-top">
                    <div>
                        <h3>${tour.name}</h3>
                        <p>Manager: <strong>${tour.managerName}</strong> • ${memberCount} Members</p>
                    </div>
                    <span class="role-badge ${isManager ? "is-manager" : ""}">
                        ${isManager ? "★ Manager" : "Member"}
                    </span>
                </div>
                <p style="color:#818cf8; font-weight:600; margin-top:10px;">Open Tour Portal →</p>
            </div>
        `;
    }).join("");
}

window.openTourPortal = function (tourId) {
    activeTourId = tourId;
    const tour = myTours.find(t => t.id === tourId);
    if (!tour) return;

    document.getElementById("toursListView").hidden = true;
    document.getElementById("tourDetailView").hidden = false;

    if (unsubscribeTourEntries) unsubscribeTourEntries();

    const entriesQuery = query(
        collection(db, "tour_entries"),
        where("tourId", "==", tourId)
    );

    unsubscribeTourEntries = onSnapshot(entriesQuery, (snapshot) => {
        activeTourEntries = [];
        snapshot.forEach((docSnap) => {
            activeTourEntries.push({ id: docSnap.id, ...docSnap.data() });
        });
        activeTourEntries.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));

        const latestTour = myTours.find(t => t.id === activeTourId) || tour;
        renderTourDetailHeaderAndSummary(latestTour);
    });
};

document.getElementById("backToToursBtn").addEventListener("click", () => {
    activeTourId = null;
    if (unsubscribeTourEntries) unsubscribeTourEntries();
    document.getElementById("tourDetailView").hidden = true;
    document.getElementById("toursListView").hidden = false;
});

function renderTourDetailHeaderAndSummary(tour) {
    const uid = currentUserData.uid;
    const isManager = tour.managerId === uid;
    const membersObj = tour.members || {};
    const memberIds = tour.memberIds || [];
    const memberCount = memberIds.length || 1;

    document.getElementById("detailTourTitle").textContent = tour.name;
    document.getElementById("detailTourMeta").textContent = `Manager: ${tour.managerName} • ${memberCount} Team Members`;

    const roleBadge = document.getElementById("tourRoleBadge");
    roleBadge.textContent = isManager ? "★ You are Manager (Admin)" : "Team Member";
    roleBadge.className = `role-badge ${isManager ? "is-manager" : ""}`;

    const actionBox = document.getElementById("tourActionButtons");
    if (isManager) {
        actionBox.innerHTML = `
            <button class="secondary-btn small-btn" onclick="openAddTourMemberModal()">+ Member</button>
            <button class="secondary-btn small-btn" onclick="openClaimMoneyModal()">📢 Claim Fund</button>
            <button class="primary-btn small-btn" onclick="openManagerEntryModal()">+ Add Cost / Deposit</button>
        `;
    } else {
        actionBox.innerHTML = `
            <button class="primary-btn small-btn" onclick="openMemberExtraCostModal()">+ Submit Extra Cost</button>
        `;
    }

    let totalManagerDeposits = 0;
    let totalManagerExpenses = 0;
    let totalApprovedMemberExtras = 0;

    const perMemberDeposit = {};
    const perMemberExtra = {};
    memberIds.forEach(id => {
        perMemberDeposit[id] = 0;
        perMemberExtra[id] = 0;
    });

    const approvedEntries = activeTourEntries.filter(e => e.status === "approved");
    const pendingExtras = activeTourEntries.filter(e => e.status === "pending");

    approvedEntries.forEach((entry) => {
        if (entry.entryType === "deposit") {
            totalManagerDeposits += entry.amount;
            perMemberDeposit[entry.memberId] = (perMemberDeposit[entry.memberId] || 0) + entry.amount;
        } else if (entry.entryType === "expense") {
            totalManagerExpenses += entry.amount;
        } else if (entry.entryType === "member_extra") {
            totalApprovedMemberExtras += entry.amount;
            perMemberExtra[entry.memberId] = (perMemberExtra[entry.memberId] || 0) + entry.amount;
        }
    });

    const grandTotalCollected = totalManagerDeposits + totalApprovedMemberExtras;
    const grandTotalExpense = totalManagerExpenses + totalApprovedMemberExtras;
    const managerStockInHand = totalManagerDeposits - totalManagerExpenses;
    const perPersonEqualShare = grandTotalExpense / memberCount;

    document.getElementById("tourTotalDeposit").textContent = formatCurrency(grandTotalCollected);
    document.getElementById("tourTotalExpense").textContent = formatCurrency(grandTotalExpense);
    document.getElementById("tourPerPersonShare").textContent = `Per person share: ${formatCurrency(perPersonEqualShare)}`;

    const stockEl = document.getElementById("tourManagerStock");
    stockEl.textContent = formatCurrency(managerStockInHand);
    stockEl.style.color = managerStockInHand < 0 ? "var(--red)" : "var(--blue)";

    const myTotalPaid = (perMemberDeposit[uid] || 0) + (perMemberExtra[uid] || 0);
    const myDiff = myTotalPaid - perPersonEqualShare;
    const myStatusEl = document.getElementById("tourMyNetStatus");
    const myLabelEl = document.getElementById("tourMyNetLabel");

    myStatusEl.textContent = formatCurrency(Math.abs(myDiff));
    if (myDiff > 0.5) {
        myStatusEl.style.color = "var(--green)";
        myLabelEl.textContent = "বেশি দিয়েছেন (ফেরত পাবেন)";
    } else if (myDiff < -0.5) {
        myStatusEl.style.color = "var(--red)";
        myLabelEl.textContent = "কম দিয়েছেন (আরও দেবেন)";
    } else {
        myStatusEl.style.color = "var(--text)";
        myLabelEl.textContent = "হিসাব সমান (Balanced)";
    }

    const pendingCard = document.getElementById("tourPendingApprovalsCard");
    const pendingList = document.getElementById("tourPendingList");
    if (pendingExtras.length === 0) {
        pendingCard.hidden = true;
    } else {
        pendingCard.hidden = false;
        document.getElementById("tourPendingCount").textContent = pendingExtras.length;
        pendingList.innerHTML = pendingExtras.map(p => `
            <div class="request-card">
                <div class="req-info">
                    <h4><strong>${p.memberName}</strong> পকেট থেকে Extra খরচ করেছেন</h4>
                    <p>বিবরণ: ${p.description} • ${formatDate(p.createdAt)}</p>
                    <div class="req-amount" style="color:#fbbf24;">${formatCurrency(p.amount)}</div>
                </div>
                ${isManager ? `
                    <div class="req-btns">
                        <button class="btn-ok" onclick="approveTourExtraCost('${p.id}', 'approved')">✓ Approve</button>
                        <button class="btn-reject" onclick="approveTourExtraCost('${p.id}', 'rejected')">✕ Reject</button>
                    </div>
                ` : `<span class="code-pill">Waiting for Manager</span>`}
            </div>
        `).join("");
    }

    const membersSummaryEl = document.getElementById("tourMembersSummaryList");
    membersSummaryEl.innerHTML = memberIds.map(mId => {
        const mInfo = membersObj[mId] || { name: "Member", userCode: "" };
        const dep = perMemberDeposit[mId] || 0;
        const ext = perMemberExtra[mId] || 0;
        const totalContributed = dep + ext;
        const diff = totalContributed - perPersonEqualShare;

        const diffBadge = diff > 0.5
            ? `<span class="ledger-amount plus">বেশি দিয়েছে: +${formatCurrency(diff)} (পাবে)</span>`
            : diff < -0.5
            ? `<span class="ledger-amount minus">কম দিয়েছে: -${formatCurrency(Math.abs(diff))} (দেবে)</span>`
            : `<span style="color:#c084fc; font-weight:700; font-size:13px;">✓ সমান (৳ 0.00)</span>`;

        return `
            <div class="tour-member-row">
                <div>
                    <h4 style="font-size:14px;">${mInfo.name} ${mId === tour.managerId ? "★" : ""} <span style="color:var(--muted); font-size:11px;">(${mInfo.userCode})</span></h4>
                    <div class="tour-member-stats">
                        <span>জমা: <strong>${formatCurrency(dep)}</strong></span>
                        <span>Extra খরচ: <strong>${formatCurrency(ext)}</strong></span>
                        <span>মোট দিয়েছে: <strong>${formatCurrency(totalContributed)}</strong></span>
                    </div>
                </div>
                <div>${diffBadge}</div>
            </div>
        `;
    }).join("");

    const historyEl = document.getElementById("tourHistoryList");
    if (approvedEntries.length === 0) {
        historyEl.innerHTML = `<p style="color:var(--muted); font-size:13px;">No deposits or expenses recorded yet.</p>`;
    } else {
        historyEl.innerHTML = approvedEntries.map(entry => {
            let badgeText = "";
            let amountClass = "plus";
            let prefix = "+";

            if (entry.entryType === "deposit") {
                badgeText = `Deposit by ${entry.memberName}`;
                amountClass = "plus";
                prefix = "+";
            } else if (entry.entryType === "expense") {
                badgeText = `Manager Expense`;
                amountClass = "minus";
                prefix = "-";
            } else {
                badgeText = `Extra Expense by ${entry.memberName} (Approved)`;
                amountClass = "settled";
                prefix = "★";
            }

            return `
                <div class="ledger-row">
                    <div class="ledger-left">
                        <h4>${entry.description}</h4>
                        <p>${badgeText} • ${formatDate(entry.createdAt)}</p>
                    </div>
                    <div class="ledger-right">
                        <div class="ledger-amount ${amountClass}">${prefix} ${formatCurrency(entry.amount)}</div>
                        <span class="ledger-tag">${entry.entryType === "expense" ? "Tour Cost" : "Fund Added"}</span>
                    </div>
                </div>
            `;
        }).join("");
    }
}

// ==========================================
// TOUR MODALS HANDLERS
// ==========================================
window.openManagerEntryModal = function () {
    const tour = myTours.find(t => t.id === activeTourId);
    if (!tour) return;

    const select = document.getElementById("tourDepositMemberSelect");
    select.innerHTML = (tour.memberIds || []).map(id => {
        const m = tour.members[id];
        return `<option value="${id}">${m.name} (${m.userCode})</option>`;
    }).join("");

    document.getElementById("managerEntryForm").reset();
    window.toggleTourMemberSelect();
    document.getElementById("managerEntryModal").hidden = false;
};

window.toggleTourMemberSelect = function () {
    const type = document.querySelector('input[name="tourEntryType"]:checked').value;
    document.getElementById("tourDepositMemberGroup").hidden = (type !== "deposit");
};

document.getElementById("managerEntryForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const tour = myTours.find(t => t.id === activeTourId);
    if (!tour || tour.managerId !== currentUserData.uid) return;

    const entryType = document.querySelector('input[name="tourEntryType"]:checked').value;
    const memberId = entryType === "deposit" ? document.getElementById("tourDepositMemberSelect").value : currentUserData.uid;
    const memberName = tour.members[memberId]?.name || currentUserData.name;
    const amount = parseFloat(document.getElementById("tourEntryAmount").value);
    const description = document.getElementById("tourEntryNote").value.trim();

    if (isNaN(amount) || amount <= 0 || !description) return;

    const btn = document.getElementById("submitManagerEntryBtn");
    btn.disabled = true;
    btn.textContent = "Saving...";

    try {
        await addDoc(collection(db, "tour_entries"), {
            tourId: tour.id,
            entryType: entryType,
            memberId: memberId,
            memberName: memberName,
            amount: amount,
            description: description,
            status: "approved",
            createdAt: serverTimestamp()
        });

        const notifMsg = entryType === "deposit"
            ? `${memberName}-এর কাছ থেকে ৳${amount} জমা নেওয়া হয়েছে (${description})।`
            : `নতুন ট্যুর খরচ ৳${amount} যুক্ত হয়েছে: ${description}`;

        await addDoc(collection(db, "tour_notifications"), {
            tourId: tour.id,
            actorId: currentUserData.uid,
            recipientIds: (tour.memberIds || []).filter(id => id !== currentUserData.uid),
            title: `${tour.name} (Updated)`,
            message: notifMsg,
            createdAt: serverTimestamp()
        });

        closeTourModal("managerEntryModal");
    } catch (error) {
        alert("Error: " + error.message);
    } finally {
        btn.disabled = false;
        btn.textContent = "Save & Notify All";
    }
});

window.openClaimMoneyModal = function () {
    document.getElementById("claimMoneyForm").reset();
    document.getElementById("claimMoneyModal").hidden = false;
};

document.getElementById("claimMoneyForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const tour = myTours.find(t => t.id === activeTourId);
    if (!tour) return;

    const amount = parseFloat(document.getElementById("claimAmountInput").value);
    const reason = document.getElementById("claimReasonInput").value.trim();
    if (isNaN(amount) || amount <= 0 || !reason) return;

    const btn = document.getElementById("submitClaimBtn");
    btn.disabled = true;
    btn.textContent = "Notifying...";

    try {
        await addDoc(collection(db, "tour_notifications"), {
            tourId: tour.id,
            actorId: currentUserData.uid,
            recipientIds: (tour.memberIds || []).filter(id => id !== currentUserData.uid),
            title: `Fund Claim: ${tour.name}`,
            message: `Manager ${currentUserData.name} জনপ্রতি আরও ৳${amount} জমা দেওয়ার অনুরোধ করেছেন (${reason})।`,
            createdAt: serverTimestamp()
        });

        alert("সব মেম্বারের কাছে টাকা জমা দেওয়ার নোটিফিকেশন পাঠানো হয়েছে!");
        closeTourModal("claimMoneyModal");
    } catch (error) {
        alert("Error: " + error.message);
    } finally {
        btn.disabled = false;
        btn.textContent = "Notify All Members";
    }
});

window.openMemberExtraCostModal = function () {
    document.getElementById("memberExtraCostForm").reset();
    document.getElementById("memberExtraCostModal").hidden = false;
};

document.getElementById("memberExtraCostForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const tour = myTours.find(t => t.id === activeTourId);
    if (!tour) return;

    const amount = parseFloat(document.getElementById("extraCostAmountInput").value);
    const description = document.getElementById("extraCostDescInput").value.trim();
    if (isNaN(amount) || amount <= 0 || !description) return;

    const btn = document.getElementById("submitExtraCostBtn");
    btn.disabled = true;
    btn.textContent = "Sending...";

    try {
        await addDoc(collection(db, "tour_entries"), {
            tourId: tour.id,
            entryType: "member_extra",
            memberId: currentUserData.uid,
            memberName: currentUserData.name,
            amount: amount,
            description: description,
            status: "pending",
            createdAt: serverTimestamp()
        });

        await addDoc(collection(db, "tour_notifications"), {
            tourId: tour.id,
            actorId: currentUserData.uid,
            recipientIds: [tour.managerId],
            title: `Extra Cost Claim: ${tour.name}`,
            message: `${currentUserData.name} পকেট থেকে ৳${amount} খরচের (${description}) অনুমোদন চেয়েছেন।`,
            createdAt: serverTimestamp()
        });

        alert("আপনার Extra খরচের আবেদন Manager-এর কাছে পাঠানো হয়েছে!");
        closeTourModal("memberExtraCostModal");
    } catch (error) {
        alert("Error: " + error.message);
    } finally {
        btn.disabled = false;
        btn.textContent = "Send to Manager";
    }
});

window.approveTourExtraCost = async function (entryId, newStatus) {
    const tour = myTours.find(t => t.id === activeTourId);
    if (!tour || tour.managerId !== currentUserData.uid) return;

    try {
        const entry = activeTourEntries.find(e => e.id === entryId);
        if (newStatus === "rejected") {
            await deleteDoc(doc(db, "tour_entries", entryId));
            return;
        }

        await updateDoc(doc(db, "tour_entries", entryId), {
            status: "approved",
            approvedAt: serverTimestamp()
        });

        if (entry) {
            await addDoc(collection(db, "tour_notifications"), {
                tourId: tour.id,
                actorId: currentUserData.uid,
                recipientIds: (tour.memberIds || []).filter(id => id !== currentUserData.uid),
                title: `${tour.name} (Extra Cost Approved)`,
                message: `${entry.memberName}-এর Extra খরচ ৳${entry.amount} (${entry.description}) কস্ট শিটে যুক্ত হয়েছে।`,
                createdAt: serverTimestamp()
            });
        }
    } catch (error) {
        alert("Error: " + error.message);
    }
};

window.openAddTourMemberModal = async function () {
    await loadConnections();
    const tour = myTours.find(t => t.id === activeTourId);
    if (!tour) return;

    const select = document.getElementById("existingTourAddSelect");
    const available = Object.values(connectedUsersMap).filter(f => !(tour.memberIds || []).includes(f.uid));

    if (available.length === 0) {
        alert("আপনার সব কানেক্টেড বন্ধু আগেই এই ট্যুরে যুক্ত আছেন!");
        return;
    }

    select.innerHTML = `<option value="">-- Choose user --</option>` +
        available.map(f => `<option value="${f.uid}">${f.name} (${f.userCode})</option>`).join("");

    document.getElementById("addTourMemberModal").hidden = false;
};

document.getElementById("addTourMemberForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const tour = myTours.find(t => t.id === activeTourId);
    const newUid = document.getElementById("existingTourAddSelect").value;
    const friend = connectedUsersMap[newUid];
    if (!tour || !friend) return;

    try {
        const updatedMembers = {
            ...(tour.members || {}),
            [friend.uid]: { uid: friend.uid, name: friend.name, userCode: friend.userCode }
        };

        await updateDoc(doc(db, "tours", tour.id), {
            memberIds: arrayUnion(friend.uid),
            members: updatedMembers
        });

        await addDoc(collection(db, "tour_notifications"), {
            tourId: tour.id,
            actorId: currentUserData.uid,
            recipientIds: [friend.uid],
            title: `Added to Tour: ${tour.name}`,
            message: `${currentUserData.name} আপনাকে "${tour.name}" ট্যুরে যুক্ত করেছেন।`,
            createdAt: serverTimestamp()
        });

        closeTourModal("addTourMemberModal");
    } catch (error) {
        alert("Error: " + error.message);
    }
});

// ==========================================
// PERSONAL BALANCES & LEDGER RENDERING
// ==========================================
document.getElementById("ledgerFilterSelect").addEventListener("change", () => {
    renderCostSheet();
});

function updateBalancesAndUI() {
    const uid = currentUserData.uid;
    const perPersonNet = {};
    let totalClearedAmount = 0;

    allTransactions.forEach((tx) => {
        const creditorId = tx.creditorId || tx.senderId;
        const debtorId = tx.debtorId || tx.receiverId;

        if (isSettlementType(tx.type)) totalClearedAmount += tx.amount;

        if (creditorId === uid) {
            perPersonNet[debtorId] = (perPersonNet[debtorId] || 0) + tx.amount;
        } else if (debtorId === uid) {
            perPersonNet[creditorId] = (perPersonNet[creditorId] || 0) - tx.amount;
        }
    });

    let remainingReceivable = 0;
    let remainingPayable = 0;

    Object.values(perPersonNet).forEach((personBalance) => {
        if (personBalance > 0) remainingReceivable += personBalance;
        else if (personBalance < 0) remainingPayable += Math.abs(personBalance);
    });

    const net = remainingReceivable - remainingPayable;

    document.getElementById("totalReceivable").textContent = formatCurrency(remainingReceivable);
    document.getElementById("totalPayable").textContent = formatCurrency(remainingPayable);
    document.getElementById("totalCleared").textContent = formatCurrency(totalClearedAmount);

    const netEl = document.getElementById("netBalance");
    const netLabelEl = document.getElementById("netBalanceLabel");
    netEl.textContent = formatCurrency(Math.abs(net));

    if (net > 0) {
        netEl.style.color = "var(--green)";
        netLabelEl.textContent = "Overall you will receive";
    } else if (net < 0) {
        netEl.style.color = "var(--red)";
        netLabelEl.textContent = "Overall you need to pay";
    } else {
        netEl.style.color = "var(--text)";
        netLabelEl.textContent = "All settled up!";
    }

    const personSummaryEl = document.getElementById("personSummaryList");
    const personKeys = Object.keys(perPersonNet);

    if (personKeys.length === 0) {
        personSummaryEl.innerHTML = `<p style="color: var(--muted); font-size: 13px;">No accepted balances yet.</p>`;
    } else {
        let pHtml = "";
        personKeys.forEach((friendId) => {
            const friend = connectedUsersMap[friendId];
            const friendName = friend ? friend.name : "Connected User";
            const balance = perPersonNet[friendId];

            const friendCleared = allTransactions
                .filter(tx => isSettlementType(tx.type) && (tx.senderId === friendId || tx.receiverId === friendId))
                .reduce((sum, tx) => sum + tx.amount, 0);

            const statusText = balance > 0
                ? `<span class="ledger-amount plus">অবশিষ্ট পাবেন ${formatCurrency(balance)}</span>`
                : balance < 0
                ? `<span class="ledger-amount minus">অবশিষ্ট দেবেন ${formatCurrency(Math.abs(balance))}</span>`
                : `<span style="color: #c084fc; font-weight: 700; font-size: 13px;">✓ All Cleared (৳ 0.00)</span>`;

            pHtml += `
                <div class="connection-item">
                    <div class="connection-left">
                        <div class="avatar">${friendName.charAt(0).toUpperCase()}</div>
                        <div class="connection-info">
                            <h4>${friendName}</h4>
                            <p>${friend ? friend.userCode : ""} • মোট ফেরত/ক্লিয়ার: <strong>${formatCurrency(friendCleared)}</strong></p>
                        </div>
                    </div>
                    <div>${statusText}</div>
                </div>
            `;
        });
        personSummaryEl.innerHTML = pHtml;
    }

    const recentEl = document.getElementById("recentTransactionsList");
    if (allTransactions.length === 0) {
        recentEl.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon"><i data-lucide="receipt-text"></i></div>
                <h3>No Transactions Yet</h3>
                <p>Your accepted money requests will appear here.</p>
            </div>
        `;
        if (window.lucide) lucide.createIcons();
    } else {
        recentEl.innerHTML = allTransactions.slice(0, 5).map(tx => buildLedgerRowHTML(tx)).join("");
    }

    renderCostSheet();
}

function renderCostSheet() {
    const filterValue = document.getElementById("ledgerFilterSelect").value;
    const fullLedgerEl = document.getElementById("fullLedgerList");

    const filtered = filterValue === "all"
        ? allTransactions
        : allTransactions.filter(tx => tx.senderId === filterValue || tx.receiverId === filterValue);

    if (filtered.length === 0) {
        fullLedgerEl.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon"><i data-lucide="book-open"></i></div>
                <h3>Your Cost Sheet is Empty</h3>
                <p>Accepted transactions will be listed here.</p>
            </div>
        `;
        if (window.lucide) lucide.createIcons();
        return;
    }

    fullLedgerEl.innerHTML = filtered.map(tx => buildLedgerRowHTML(tx)).join("");
}

function buildLedgerRowHTML(tx) {
    const uid = currentUserData.uid;
    const creditorId = tx.creditorId || tx.senderId;
    const isReceivable = creditorId === uid;

    const otherPersonName = isReceivable
        ? (tx.debtorName || tx.receiverName)
        : (tx.creditorName || tx.senderName);

    if (isSettlementType(tx.type)) {
        const payerId = (tx.type === "ferot_diyeche") ? tx.receiverId : tx.senderId;
        const iPaidBack = payerId === uid;

        return `
            <div class="ledger-row">
                <div class="ledger-left">
                    <h4>${tx.description}</h4>
                    <p>${iPaidBack ? `আপনি <strong>${otherPersonName}</strong>-কে ফেরত দিয়েছেন` : `<strong>${otherPersonName}</strong> আপনাকে ফেরত দিয়েছেন`} • ${formatDate(tx.acceptedAt || tx.createdAt)}</p>
                </div>
                <div class="ledger-right">
                    <div class="ledger-amount settled">✓ ${formatCurrency(tx.amount)}</div>
                    <span class="ledger-tag settled-tag">${iPaidBack ? "ফেরত দিয়েছি" : "ফেরত পেয়েছি"}</span>
                </div>
            </div>
        `;
    }

    return `
        <div class="ledger-row">
            <div class="ledger-left">
                <h4>${tx.description}</h4>
                <p>${isReceivable ? `From: <strong>${otherPersonName}</strong>` : `To: <strong>${otherPersonName}</strong>`} • ${formatDate(tx.acceptedAt || tx.createdAt)}</p>
            </div>
            <div class="ledger-right">
                <div class="ledger-amount ${isReceivable ? "plus" : "minus"}">
                    ${isReceivable ? "+" : "-"} ${formatCurrency(tx.amount)}
                </div>
                <span class="ledger-tag">${isReceivable ? "আপনি পাবেন" : "আপনি দেবেন"}</span>
            </div>
        </div>
    `;
}

// PAGE NAVIGATION
function showPage(pageName) {
    document.querySelectorAll(".page").forEach(page => page.classList.remove("active"));
    const selectedPage = document.getElementById(pageName);
    if (selectedPage) selectedPage.classList.add("active");

    document.querySelectorAll(".nav-item").forEach(button => {
        button.classList.toggle("active", button.dataset.page === pageName);
    });
    document.querySelectorAll(".mobile-nav-item").forEach(button => {
        button.classList.toggle("active", button.dataset.page === pageName);
    });

    window.scrollTo({ top: 0, behavior: "smooth" });
}

document.querySelectorAll("[data-page]").forEach(button => {
    button.addEventListener("click", () => showPage(button.dataset.page));
});

// LOGOUT
document.getElementById("logoutBtn").addEventListener("click", async () => {
    if (confirm("Are you sure you want to logout?")) {
        cleanupListeners();
        await signOut(auth);
        isSignup = false;
        authTitle.textContent = "Welcome Back!";
        authSubtitle.textContent = "Login to manage your money & tour records.";
        authButton.textContent = "Login to Account";
        switchText.textContent = "Don't have an account?";
        switchAuth.textContent = "Sign Up";
        nameGroup.hidden = true;
        document.getElementById("fullName").required = false;
    }
});

// INITIALIZE ICONS
document.addEventListener("DOMContentLoaded", () => {
    if (window.lucide) lucide.createIcons();
});
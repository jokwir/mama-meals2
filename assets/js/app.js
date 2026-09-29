const deliveryFee = 30;
const cartStorageKey = "mamaMealsCart";
const selectedLocationStorageKey = "mamaMealsSelectedLocation";
const checkoutAttemptStorageKey = "mamaMealsCheckoutAttempt";
let checkoutAttempt = null;

const locationProfiles = {
    "Nairobi, Kenya": { feeAdjust: 0, timeAdjust: 0 },
    "Kilimani": { feeAdjust: 10, timeAdjust: 5 },
    "Lavington": { feeAdjust: 20, timeAdjust: 8 },
    "Westlands": { feeAdjust: 15, timeAdjust: 6 },
    "Nairobi CBD": { feeAdjust: 0, timeAdjust: 3 },
    "Current Location": { feeAdjust: 12, timeAdjust: 5 }
};

const vendorShops = {
    "bibis": {
        name: "Bibi's Traditional Meals",
        image: "images/01_bibis_traditional_meals.png",
        logo: "images/01_bibis_traditional_meals.png",
        description: "Traditional Githeri and Mukimo prepared with homestyle Kenyan flavor.",
        about: "A homestyle kitchen serving comforting Kenyan staples inspired by family recipes, slow-cooked stews, and generous portions.",
        meta: "30-45 min",
        openingHours: "Mon-Sat, 8:00 AM - 8:30 PM",
        isOpen: true,
        serviceArea: "Westlands, Parklands, CBD, Ngara and nearby estates",
        rating: 4.8,
        reviewCount: 246,
        categories: {
            "Main Meals": [
                { name: "Mukimo Plate", description: "Mashed potatoes, maize, greens and tender vegetables.", price: 350 },
                { name: "Githeri Bowl", description: "Slow-cooked maize and beans with rich seasoning.", price: 320 },
                { name: "Beef Stew Meal", description: "Beef stew served with greens and your choice of starch.", price: 420 }
            ],
            "Sides": [
                { name: "Sukuma Wiki", description: "Fresh sauteed greens with onion and tomato.", price: 120 },
                { name: "Kachumbari", description: "Tomato, onion and coriander salad.", price: 90 }
            ],
            "Drinks": [
                { name: "Fresh Passion Juice", description: "Chilled passion fruit juice.", price: 150 },
                { name: "Bottled Water", description: "Still bottled water.", price: 80 }
            ],
            "Snacks": [
                { name: "Mandazi", description: "Soft Kenyan fried dough snack.", price: 70 },
                { name: "Roasted Groundnuts", description: "Lightly salted roasted groundnuts.", price: 100 }
            ]
        }
    },
    "chapati": {
        name: "The Chapati Spot",
        image: "images/02_chapati_spot.png",
        logo: "images/02_chapati_spot.png",
        description: "Soft layered chapatis with hearty stews and quick bites.",
        about: "A quick local favorite for fresh layered chapatis, stews, wraps, and snacks made throughout the day.",
        meta: "20-30 min",
        openingHours: "Daily, 7:00 AM - 9:00 PM",
        isOpen: true,
        serviceArea: "Kilimani, Kileleshwa, Lavington, Hurlingham and nearby offices",
        rating: 4.5,
        reviewCount: 198,
        categories: {
            "Main Meals": [
                { name: "Chapati and Beans", description: "Two soft chapatis with stewed beans.", price: 200 },
                { name: "Chapati and Beef Stew", description: "Layered chapati with rich beef stew.", price: 380 },
                { name: "Chapati Wrap", description: "Chapati wrapped with eggs, vegetables and sauce.", price: 260 }
            ],
            "Sides": [
                { name: "Extra Chapati", description: "One freshly cooked layered chapati.", price: 70 },
                { name: "Bean Stew Side", description: "Small bowl of stewed beans.", price: 120 }
            ],
            "Drinks": [
                { name: "Tangawizi Soda", description: "Cold ginger soda.", price: 120 },
                { name: "Mango Juice", description: "Sweet chilled mango juice.", price: 150 }
            ],
            "Snacks": [
                { name: "Samosa", description: "Crisp pastry filled with spiced minced beef.", price: 90 },
                { name: "Chapati Roll Bite", description: "Mini chapati roll with vegetable filling.", price: 110 }
            ]
        }
    },
    "mama-sarah": {
        name: "Mama Sarah's Kitchen",
        image: "images/03_mama_sarahs_kitchen.png",
        logo: "images/03_mama_sarahs_kitchen.png",
        description: "Authentic Pilau and Nyama Choma made with love.",
        about: "A weekend-style kitchen known for fragrant pilau, grilled meats, kachumbari, and celebratory Kenyan plates.",
        meta: "40-50 min",
        openingHours: "Tue-Sun, 10:00 AM - 10:00 PM",
        isOpen: false,
        serviceArea: "Kilimani, Upper Hill, South B, South C and nearby neighborhoods",
        rating: 4.9,
        reviewCount: 321,
        categories: {
            "Main Meals": [
                { name: "Chicken Pilau", description: "Spiced rice with tender chicken pieces.", price: 450 },
                { name: "Nyama Choma Plate", description: "Chargrilled beef served with kachumbari.", price: 650 },
                { name: "Pilau and Kachumbari", description: "Fragrant pilau rice with fresh salad.", price: 380 }
            ],
            "Sides": [
                { name: "Ugali Side", description: "Classic maize meal accompaniment.", price: 100 },
                { name: "Kachumbari Side", description: "Fresh tomato and onion salad.", price: 90 }
            ],
            "Drinks": [
                { name: "Fresh Tamarind Juice", description: "Chilled ukwaju juice.", price: 160 },
                { name: "Bottled Water", description: "Still bottled water.", price: 80 }
            ],
            "Snacks": [
                { name: "Beef Samosa", description: "Crispy samosa with spiced beef filling.", price: 90 },
                { name: "Grilled Maize", description: "Chargrilled maize with lemon and chili.", price: 120 }
            ]
        }
    },
    "nairobi": {
        name: "Nairobi Delights",
        image: "images/04_nairobi_delights.png",
        logo: "images/04_nairobi_delights.png",
        description: "Ugali, Sukuma and fresh Fish served local-style.",
        about: "A dependable local kitchen for everyday Kenyan plates, fresh fish, ugali, greens, juices, and light snacks.",
        meta: "25-35 min",
        openingHours: "Mon-Sun, 9:00 AM - 8:00 PM",
        isOpen: true,
        serviceArea: "CBD, Eastleigh, Pangani, South B, Industrial Area and nearby estates",
        rating: 4.6,
        reviewCount: 174,
        categories: {
            "Main Meals": [
                { name: "Fish and Ugali", description: "Fresh fish served with ugali and greens.", price: 380 },
                { name: "Ugali Sukuma Plate", description: "Classic ugali with sauteed sukuma wiki.", price: 240 },
                { name: "Tilapia Stew", description: "Tilapia cooked in tomato stew with herbs.", price: 520 }
            ],
            "Sides": [
                { name: "Extra Ugali", description: "Extra serving of ugali.", price: 80 },
                { name: "Sukuma Side", description: "Sauteed greens with tomato.", price: 120 }
            ],
            "Drinks": [
                { name: "Sugarcane Juice", description: "Fresh pressed sugarcane juice.", price: 160 },
                { name: "Lemonade", description: "Chilled house lemonade.", price: 140 }
            ],
            "Snacks": [
                { name: "Bhajia", description: "Crispy potato slices with spices.", price: 180 },
                { name: "Roasted Cassava", description: "Cassava snack with chili and lemon.", price: 130 }
            ]
        }
    }
};

function formatShillings(value) {
    return `KSh ${value.toLocaleString("en-KE")}`;
}

function getSelectedLocation() {
    return localStorage.getItem(selectedLocationStorageKey) || "Nairobi, Kenya";
}

function saveSelectedLocation(location) {
    localStorage.setItem(selectedLocationStorageKey, location || "Nairobi, Kenya");
}

function getLocationProfile(location = getSelectedLocation()) {
    return locationProfiles[location] || { feeAdjust: 18, timeAdjust: 7 };
}

function getVendorDeliveryInfo(vendor, location = getSelectedLocation()) {
    const profile = getLocationProfile(location);
    const baseFee = Number(vendor.dataset.fee || 30);
    const baseTime = Number(vendor.dataset.time || 35);
    const fee = Math.max(0, baseFee + profile.feeAdjust);
    const maxTime = Math.max(15, baseTime + profile.timeAdjust);
    const minTime = Math.max(10, maxTime - 12);
    return { fee, minTime, maxTime };
}

function slugify(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;"
    }[character]));
}

function getShopMenuItems(shop) {
    return Object.entries(shop.categories).flatMap(([category, items]) => (
        items.map((item) => ({ ...item, category, slug: item.menuItemId || slugify(item.name) }))
    ));
}

function getMarketplaceShop(vendorId) {
    if (!vendorId.startsWith("partner-")) return null;
    const vendor = (getFirebaseState().marketplaceVendors || [])
        .find((entry) => `partner-${entry.id}` === vendorId);
    if (!vendor) return null;
    const categories = { "Main Meals": [], Sides: [], Drinks: [], Snacks: [] };
    vendor.items.forEach((item) => {
        if (!categories[item.category]) return;
        categories[item.category].push({
            name: item.name,
            description: item.description,
            price: Number(item.price),
            image: item.imageUrl,
            menuItemId: item.id,
            vendorOwnerId: vendor.id
        });
    });
    const image = vendor.items[0]?.imageUrl || "images/01_bibis_traditional_meals.png";
    return {
        name: vendor.kitchenName || "Local Kitchen",
        image,
        logo: image,
        description: vendor.about || "Fresh meals from a Mama Meals partner kitchen.",
        about: vendor.about || "Mama Meals approved kitchen partner.",
        meta: "Delivery available",
        openingHours: "Ask the kitchen for today's hours",
        isOpen: vendor.acceptingOrders === true,
        serviceArea: vendor.serviceArea || "Nairobi",
        rating: null,
        reviewCount: 0,
        isPartner: true,
        categories
    };
}

function renderMarketplaceVendors() {
    const list = document.querySelector("#vendor-list");
    if (!list) return;
    (getFirebaseState().marketplaceVendors || []).forEach((vendor) => {
        const first = vendor.items[0];
        const name = vendor.kitchenName || "Local Kitchen";
        const open = vendor.acceptingOrders === true;
        const minPrice = Math.min(...vendor.items.map((item) => Number(item.price)));
        const card = document.createElement("article");
        card.className = "vendor-card";
        card.dataset.vendorId = `partner-${vendor.id}`;
        card.dataset.name = name;
        card.dataset.keywords = vendor.items.map((item) => `${item.name} ${item.description} ${item.category}`).join(" ");
        card.dataset.cuisine = "";
        card.dataset.minOrder = String(minPrice);
        card.dataset.bestSeller = "false";
        card.dataset.fastDelivery = "false";
        card.dataset.pickup = "false";
        card.dataset.offers = "false";
        card.dataset.open = String(open);
        card.dataset.fee = "30";
        card.dataset.time = "45";
        card.dataset.rating = "0";
        card.dataset.price = String(minPrice);
        card.setAttribute("role", "link");
        card.tabIndex = 0;
        card.setAttribute("aria-label", `Open ${name} shop`);
        card.innerHTML = `
            <img src="${escapeHtml(first.imageUrl)}" alt="${escapeHtml(name)}">
            <span class="vendor-logo-badge"><img src="${escapeHtml(first.imageUrl)}" alt=""></span>
            <div class="vendor-details">
                <div class="vendor-badges"><span class="vendor-badge cuisine-badge">${open ? "Accepting orders" : "Not accepting orders"}</span></div>
                <h3>${escapeHtml(name)}</h3>
                <p>${escapeHtml(first.name)}${vendor.items.length > 1 ? ` and ${vendor.items.length - 1} more` : ""}</p>
                <div class="vendor-meta"><span>From ${formatShillings(minPrice)}</span><span>${escapeHtml(vendor.serviceArea || "Nairobi")}</span></div>
            </div>
        `;
        list.appendChild(card);
    });
}

function getDishDetails(item, shop) {
    const category = item.category || "Main Meals";
    const isDrink = category === "Drinks";
    const isSide = category === "Sides";
    const isSnack = category === "Snacks";

    return {
        photo: item.image || shop.image,
        fullDescription: `${item.description} Prepared by ${shop.name} and packed fresh for delivery or pickup.`,
        ingredients: isDrink
            ? ["Fresh drink base", "Filtered water", "Light natural sweetness", "Served chilled"]
            : isSide
                ? ["Fresh local produce", "House seasoning", "Light oil", "Cooked to order"]
                : isSnack
                    ? ["Fresh dough or produce", "House spices", "Crisp finish", "Served warm"]
                    : ["Fresh local ingredients", "House spice blend", "Vegetables", "Served with balanced accompaniments"],
        portion: isDrink ? "500 ml bottle/cup" : isSide ? "Single side portion" : isSnack ? "One snack serving" : "Full meal portion",
        options: isDrink
            ? ["Chilled", "No added sugar where available"]
            : ["Mild spice", "Medium spice", "Extra kachumbari where available"],
        addOns: isDrink
            ? [{ name: "Extra bottle", price: item.price }]
            : [
                { name: "Extra stew", price: 80 },
                { name: "Extra chapati", price: 70 },
                { name: "Kachumbari side", price: 90 }
            ]
    };
}

function getVendorSearchText(vendorId) {
    const shop = vendorShops[vendorId] || getMarketplaceShop(vendorId);
    if (!shop) {
        return "";
    }

    return [
        shop.name,
        shop.description,
        shop.about,
        shop.serviceArea,
        ...getShopMenuItems(shop).flatMap((item) => {
            const details = getDishDetails(item, shop);
            return [
                item.name,
                item.description,
                item.category,
                details.fullDescription,
                details.portion,
                ...details.ingredients,
                ...details.options
            ];
        })
    ].join(" ").toLowerCase();
}

function normalizeSearchText(value = "") {
    return String(value)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

function findDish(vendorId, dishSlug) {
    const shop = vendorShops[vendorId] || getMarketplaceShop(vendorId)
        || (vendorId.startsWith("partner-") ? null : vendorShops.bibis);
    if (!shop) return { shop: null, item: null };
    const items = getShopMenuItems(shop);
    return {
        shop,
        item: items.find((menuItem) => menuItem.slug === dishSlug)
            || (shop.isPartner ? null : items[0])
    };
}

function getCart() {
    try {
        const items = JSON.parse(localStorage.getItem(cartStorageKey));
        if (!Array.isArray(items)) return [];
        return items.map((item) => {
            const name = String(item?.name || "").trim().slice(0, 120);
            const [legacyBaseName, legacyAddOns] = name.split(" + ", 2);
            return {
                name,
                price: Number(item?.price),
                image: String(item?.image || "").slice(0, 1000),
                quantity: Math.max(1, Math.min(50, Number(item?.quantity) || 1)),
                baseName: item?.baseName ? String(item.baseName).slice(0, 120) : legacyBaseName,
                addOns: Array.isArray(item?.addOns) ? item.addOns.map(String).slice(0, 3) : (legacyAddOns?.split(", ") || []),
                menuItemId: item?.menuItemId ? String(item.menuItemId).slice(0, 80) : undefined,
                vendorOwnerId: item?.vendorOwnerId ? String(item.vendorOwnerId).slice(0, 128) : undefined,
                shopId: item?.shopId ? String(item.shopId).slice(0, 80) : undefined
            };
        }).filter((item) => item.name && Number.isFinite(item.price) && item.price > 0);
    } catch {
        return [];
    }
}

function saveCart(items) {
    localStorage.setItem(cartStorageKey, JSON.stringify(items));
}

async function getCheckoutRequestId(order) {
    const fingerprintSource = JSON.stringify({
        userId: getFirebaseState().user.uid,
        deliveryAddress: order.deliveryAddress,
        phone: order.phone,
        deliveryInstructions: order.deliveryInstructions,
        notes: order.notes,
        paymentMethod: order.paymentMethod,
        items: order.items.map((item) => ({
            menuItemId: item.menuItemId,
            quantity: item.quantity,
            addOns: item.addOns
        }))
    });
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(fingerprintSource));
    const fingerprint = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    try {
        checkoutAttempt = JSON.parse(sessionStorage.getItem(checkoutAttemptStorageKey)) || checkoutAttempt;
    } catch {
        // Private browsing can block storage; the in-memory attempt still protects retries in this tab.
    }
    if (checkoutAttempt?.fingerprint !== fingerprint
        || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(checkoutAttempt.requestId || "")) {
        checkoutAttempt = { fingerprint, requestId: crypto.randomUUID() };
        try {
            sessionStorage.setItem(checkoutAttemptStorageKey, JSON.stringify(checkoutAttempt));
        } catch {
            // Keep the attempt in memory when session storage is unavailable.
        }
    }
    return checkoutAttempt.requestId;
}

function clearCheckoutAttempt() {
    checkoutAttempt = null;
    try {
        sessionStorage.removeItem(checkoutAttemptStorageKey);
    } catch {
        // Checkout has already succeeded; a blocked session store cannot undo the order.
    }
}

function getFirebaseBackend() {
    return window.mamaMealsFirebase || null;
}

function getFirebaseState() {
    return getFirebaseBackend()?.state || {};
}

function hasActiveAccount() {
    return Boolean(getFirebaseState().user && getFirebaseState().profile);
}

async function clearActiveAccount() {
    const backend = getFirebaseBackend();
    if (!backend?.state.configured) {
        throw new Error(backend?.state.error || "Firebase authentication is not configured.");
    }
    await backend.logout();
}

function getFirstName(profile) {
    return (profile?.fullName || profile?.name || "there").trim().split(/\s+/)[0] || "there";
}

function getAccountProfile() {
    return getFirebaseState().profile || null;
}

function getUsers() {
    return getFirebaseState().users || [];
}

function normalizeEmail(email) {
    return (email || "").trim().toLowerCase();
}

function isAdminProfile() {
    return getFirebaseState().claims?.admin === true;
}

function userHasRole(profile, role) {
    if (!profile) {
        return false;
    }
    return role === "customer" || getFirebaseState().claims?.[role] === true;
}

function getOrders() {
    return getFirebaseState().orders || [];
}

function getPartnerApplications() {
    return getFirebaseState().applicationsByUser || {};
}

function getApplicationRecords() {
    return getFirebaseState().applications || [];
}

function getSafeReturnTarget(fallback = "account.html") {
    const requested = new URLSearchParams(window.location.search).get("returnTo");
    if (!requested || !/^[a-z0-9-]+\.html(?:[?#][a-z0-9=&_%.-]*)?$/i.test(requested)) {
        return fallback;
    }
    return requested;
}

function getActiveProfile() {
    return hasActiveAccount() ? getAccountProfile() : null;
}

function getOrdersForActiveAccount() {
    const profile = getActiveProfile();
    if (!profile) {
        return [];
    }

    return getOrders().filter((order) => order.userId === profile.userId);
}

function findOrderForTracking() {
    const profile = getActiveProfile();
    const orders = isAdminProfile()
        ? getOrders()
        : getOrders().filter((order) => (
            order.customerId === profile?.userId
            || order.userId === profile?.userId
            || (userHasRole(profile, "vendor") && order.vendorOwnerId === profile.userId)
            || (userHasRole(profile, "rider") && order.assignedRiderId === profile.userId)
        ));
    if (!orders.length) {
        return null;
    }

    const params = new URLSearchParams(window.location.search);
    const orderId = params.get("order");
    return orders.find((order) => order.id === orderId) || orders[0];
}

function getVendorNameForOrder(order) {
    const firstItem = order?.items?.[0];
    if (!firstItem) {
        return "Mama Meals Kitchen";
    }

    const vendor = Object.values(vendorShops).find((shop) => (
        firstItem.image === shop.image ||
        Object.values(shop.categories).flat().some((item) => item.name === firstItem.name)
    ));

    return vendor?.name || "Mama Meals Kitchen";
}

function getCartTotals(items = getCart()) {
    const itemCount = items.reduce((total, item) => total + item.quantity, 0);
    const subtotal = items.reduce((total, item) => total + item.price * item.quantity, 0);
    const total = itemCount > 0 ? subtotal + deliveryFee : 0;

    return { itemCount, subtotal, total };
}

function cartKitchenKey(item) {
    if (item.menuItemId) return `partner:${item.vendorOwnerId || "unknown"}`;
    return item.shopId ? `shop:${item.shopId}` : "legacy";
}

function cartItemKey(item) {
    return item.menuItemId || item.name;
}

function addItemToCart(item) {
    if (!item.menuItemId || !item.vendorOwnerId) {
        window.showAppStatus?.("This sample meal is not available to order. Choose a published partner menu item.", true);
        return null;
    }
    let items = getCart();
    if (items.length && items.some((cartItem) => cartKitchenKey(cartItem) !== cartKitchenKey(item))) {
        if (!window.confirm("Start a new cart for this kitchen? Your current cart will be replaced.")) return null;
        items = [];
    }
    const existing = items.find((cartItem) => cartItemKey(cartItem) === cartItemKey(item));

    if (existing) {
        existing.quantity += 1;
    } else {
        items.push({ ...item, quantity: 1 });
    }

    saveCart(items);
    return items;
}

function updateItemQuantity(itemKey, change) {
    const items = getCart()
        .map((item) => cartItemKey(item) === itemKey ? { ...item, quantity: item.quantity + change } : item)
        .filter((item) => item.quantity > 0);

    saveCart(items);
    return items;
}

function initAccountPrototype() {
    document.querySelectorAll("[data-auth-form]").forEach((form) => {
        const message = form.querySelector("[data-auth-message]") || document.querySelector("[data-auth-message]");

        function showMessage(text, isError = false) {
            if (message) {
                message.textContent = text;
                message.hidden = false;
                message.classList.toggle("error", isError);
            } else {
                alert(text);
            }
        }

        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            const backend = getFirebaseBackend();
            const submitButton = form.querySelector('button[type="submit"]');
            if (!backend?.state.configured) {
                showMessage(backend?.state.error || "Secure authentication is not configured yet.", true);
                return;
            }

            submitButton?.setAttribute("disabled", "");
            try {
                if (form.dataset.authForm === "register") {
                    const email = normalizeEmail(form.elements.email.value);
                    const password = form.elements.password.value;
                    const confirmPassword = form.elements.confirmPassword.value;

                    if (!email) throw new Error("Please enter an email address so we can verify your account.");
                    if (password.length < 6) throw new Error("Password must be at least 6 characters.");
                    if (password !== confirmPassword) throw new Error("Passwords do not match.");

                    await backend.register({
                        fullName: form.elements.fullName.value.trim(),
                        phone: form.elements.phone.value.trim(),
                        email,
                        location: form.elements.location.value.trim()
                    }, password);
                    showMessage("Account created. Check your inbox to verify your email address.");
                    window.location.href = getSafeReturnTarget(form.getAttribute("action") || "account.html");
                } else {
                    const email = normalizeEmail(form.elements.loginId.value);
                    const password = form.elements.password.value;
                    await backend.login(email, password);
                    window.location.href = getSafeReturnTarget("index.html");
                }
            } catch (error) {
                showMessage(error.message || "Authentication could not be completed.", true);
            } finally {
                submitButton?.removeAttribute("disabled");
            }
        });
    });

    document.querySelectorAll("[data-password-reset]").forEach((button) => {
        button.addEventListener("click", async (event) => {
            event.preventDefault();
            const loginValue = document.querySelector("#login-id")?.value.trim() || "";
            const email = normalizeEmail(prompt("Enter the email address for your password reset", loginValue));

            if (!email) {
                return;
            }

            try {
                await getFirebaseBackend()?.requestPasswordReset(email);
                alert("If an account exists for that email, Firebase has sent password reset instructions.");
            } catch (error) {
                alert(error.message || "Password reset could not be requested.");
            }
        });
    });
}

function initPersistentAuthNavigation() {
    const authActionGroups = Array.from(document.querySelectorAll("[data-auth-actions]"));
    const oldWelcomeLinks = Array.from(document.querySelectorAll("[data-auth-welcome]"));
    const profile = getActiveProfile();

    document.querySelectorAll(".auth-session-nav").forEach((nav) => nav.remove());

    if (!profile) {
        authActionGroups.forEach((group) => {
            group.hidden = false;
            group.style.display = "";
            group.querySelectorAll(".auth-link").forEach((link) => {
                link.hidden = false;
            });
        });
        oldWelcomeLinks.forEach((link) => {
            link.hidden = true;
            link.textContent = "";
        });
        return;
    }

    authActionGroups.forEach((group) => {
        group.hidden = true;
        group.style.display = "none";
    });

    oldWelcomeLinks.forEach((link) => {
        link.hidden = true;
        link.textContent = "";
    });

    const anchor = oldWelcomeLinks[0] || authActionGroups[0];
    if (!anchor?.parentElement) {
        return;
    }

    const nav = document.createElement("nav");
    nav.className = "auth-session-nav";
    nav.setAttribute("aria-label", "Account navigation");
    nav.innerHTML = `
        <a class="auth-greeting" href="account.html"></a>
        <a class="auth-account-link" href="account.html">My Account</a>
        <button class="auth-logout-button" type="button">Log Out</button>
    `;
    nav.querySelector(".auth-greeting").textContent = `Hi ${getFirstName(profile)}`;

    anchor.parentElement.appendChild(nav);
    nav.querySelector(".auth-logout-button").addEventListener("click", async () => {
        try {
            await clearActiveAccount();
            window.location.href = "index.html";
        } catch (error) {
            window.showAppStatus?.(error.message || "Could not sign out.", true);
        }
    });
}

function initAccountPage() {
    const signedOutState = document.querySelector("#account-signed-out");
    const accountContent = Array.from(document.querySelectorAll(".account-content"));
    const addAddressButton = document.querySelector("#add-address");
    const addressList = document.querySelector("#address-list");
    const addressEditor = document.querySelector("#address-editor");
    const addressEditorInput = document.querySelector("#address-editor-input");
    const cancelAddressEdit = document.querySelector("#cancel-address-edit");
    const partnerDashboardLinks = document.querySelector("#partner-dashboard-links");
    const applicationStatusList = document.querySelector("#application-status-list");
    const adminAccountLink = document.querySelector("#admin-account-link");
    const verificationStatus = document.querySelector("#email-verification-status");
    const verificationButton = document.querySelector("#verify-email-button");
    const saveProfileButton = document.querySelector("#save-profile");

    if (!signedOutState || !accountContent.length) {
        return;
    }

    const profile = getActiveProfile();

    if (!profile) {
        signedOutState.classList.add("visible");
        accountContent.forEach((section) => {
            section.hidden = true;
        });
        return;
    }

    signedOutState.classList.remove("visible");
    signedOutState.hidden = true;
    accountContent.forEach((section) => {
        section.hidden = false;
    });

    document.querySelectorAll("[data-profile-field]").forEach((input) => {
        input.value = profile[input.dataset.profileField] || "";
    });

    async function persistProfileUpdates(updates) {
        const backend = getFirebaseBackend();
        if (!backend?.state.configured) throw new Error("Secure account services are not configured.");
        await backend.updateProfile({ ...(getAccountProfile() || profile), ...updates });
    }

    saveProfileButton?.addEventListener("click", async () => {
        const updates = {};
        document.querySelectorAll("[data-profile-field]").forEach((input) => {
            updates[input.dataset.profileField] = input.value.trim();
        });

        if (!updates.fullName || !updates.phone || !updates.location) {
            window.showAppStatus?.("Name, phone, and location are required.", true);
            return;
        }

        try {
            await persistProfileUpdates(updates);
            window.showAppStatus?.("Profile details saved.");
        } catch (error) {
            window.showAppStatus?.(error.message || "Profile details could not be saved.", true);
        }
    });

    if (verificationStatus && verificationButton) {
        if (profile.emailVerified) {
            verificationStatus.textContent = "Email verified";
            verificationButton.hidden = true;
        } else {
            verificationStatus.textContent = "Email verification pending. Check your inbox or resend the verification email.";
            verificationButton.hidden = false;
            verificationButton.addEventListener("click", async () => {
                try {
                    await getFirebaseBackend()?.resendVerification();
                    window.showAppStatus?.("Verification email sent. Check your inbox.");
                } catch (error) {
                    window.showAppStatus?.(error.message || "Verification email could not be sent.", true);
                }
            });
        }
    }

    if (adminAccountLink) {
        adminAccountLink.hidden = !isAdminProfile(profile);
    }

    function getCurrentAddresses() {
        const currentProfile = getAccountProfile() || profile;
        return currentProfile.addresses || [currentProfile.location].filter(Boolean);
    }

    async function saveAddresses(addresses) {
        await persistProfileUpdates({ addresses });
    }

    function renderAddress(address, index) {
        const row = document.createElement("article");
        row.className = "mini-list-item";
        row.innerHTML = `
            <span></span>
            <div>
                <button type="button" data-address-edit="${index}">Edit</button>
                <button type="button" data-address-delete="${index}">Delete</button>
            </div>
        `;
        row.querySelector("span").textContent = address;
        addressList.appendChild(row);
    }

    function renderAddresses() {
        if (!addressList) {
            return;
        }
        addressList.innerHTML = "";
        const addresses = getCurrentAddresses();
        addresses.forEach(renderAddress);
        if (!addresses.length) {
            addressList.innerHTML = '<p class="empty-state visible">No saved addresses yet.</p>';
        }
    }

    if (addAddressButton && addressList && addressEditor && addressEditorInput) {
        let editingAddressIndex = -1;
        renderAddresses();

        function closeAddressEditor() {
            editingAddressIndex = -1;
            addressEditor.reset();
            addressEditor.hidden = true;
            addAddressButton.focus();
        }

        addAddressButton.addEventListener("click", () => {
            editingAddressIndex = -1;
            addressEditor.reset();
            addressEditor.hidden = false;
            addressEditorInput.focus();
        });

        cancelAddressEdit?.addEventListener("click", closeAddressEditor);

        addressEditor.addEventListener("submit", async (event) => {
            event.preventDefault();
            const address = addressEditorInput.value.trim();
            if (address.length < 10) {
                window.showAppStatus?.("Please enter a fuller address.", true);
                return;
            }
            const addresses = getCurrentAddresses();
            if (editingAddressIndex >= 0) {
                addresses[editingAddressIndex] = address;
            } else {
                addresses.push(address);
            }
            try {
                await saveAddresses(addresses);
                renderAddresses();
                closeAddressEditor();
                window.showAppStatus?.("Delivery address saved.");
            } catch (error) {
                window.showAppStatus?.(error.message || "Delivery address could not be saved.", true);
            }
        });

        addressList.addEventListener("click", async (event) => {
            const editButton = event.target.closest("[data-address-edit]");
            const deleteButton = event.target.closest("[data-address-delete]");
            if (editButton) {
                editingAddressIndex = Number(editButton.dataset.addressEdit);
                addressEditorInput.value = getCurrentAddresses()[editingAddressIndex] || "";
                addressEditor.hidden = false;
                addressEditorInput.focus();
            }
            if (deleteButton) {
                const index = Number(deleteButton.dataset.addressDelete);
                try {
                    await saveAddresses(getCurrentAddresses().filter((_, itemIndex) => itemIndex !== index));
                    renderAddresses();
                    window.showAppStatus?.("Delivery address removed.");
                } catch (error) {
                    window.showAppStatus?.(error.message || "Delivery address could not be removed.", true);
                }
            }
        });
    }

    if (partnerDashboardLinks && applicationStatusList) {
        const applications = getPartnerApplications();
        const userApplications = applications[profile.userId] || {};
        const links = [];
        const statusCards = [];

        function applicationStatusCard(type, application) {
            if (!application) {
                return "";
            }
            const labels = {
                pending: "Pending review",
                approved: "Approved",
                declined: "Needs attention"
            };
            const label = labels[application.status] || "Saved";
            const statusClass = application.status === "approved" ? "status-delivered" : application.status === "declined" ? "status-cancelled" : "status-pending";
            const typeLabel = type === "cook" ? "Cook application" : "Rider application";
            const nextLink = application.status === "declined"
                ? `<a class="text-action" href="apply-${type === "cook" ? "cook" : "rider"}.html">Update and reapply</a>`
                : "";
            return `
                <article class="application-status-card">
                    <div><strong>${typeLabel}</strong><span>${application.reference || "Reference pending"}</span></div>
                    <span class="status-badge ${statusClass}">${label}</span>
                    ${nextLink}
                </article>
            `;
        }

        if (userHasRole(profile, "vendor")) {
            links.push('<a class="account-row-link" href="vendor-dashboard.html">My Vendor Dashboard</a>');
        }

        if (userHasRole(profile, "rider")) {
            links.push('<a class="account-row-link" href="rider-dashboard.html">My Rider Dashboard</a>');
        }

        statusCards.push(applicationStatusCard("cook", userApplications.cook));
        statusCards.push(applicationStatusCard("rider", userApplications.rider));

        partnerDashboardLinks.innerHTML = links.join("");
        partnerDashboardLinks.hidden = links.length === 0;
        applicationStatusList.innerHTML = statusCards.filter(Boolean).join("");
        applicationStatusList.hidden = !statusCards.some(Boolean);
    }
}

function initAdminDashboard() {
    const adminDashboard = document.querySelector("[data-admin-dashboard]");
    const adminDenied = document.querySelector("#admin-denied");
    const adminContent = Array.from(document.querySelectorAll(".admin-content"));

    if (!adminDashboard || !adminDenied) {
        return;
    }

    const profile = getActiveProfile();
    if (!isAdminProfile()) {
        adminDenied.classList.add("visible");
        adminContent.forEach((section) => {
            section.hidden = true;
        });
        if (profile) {
            const bootstrapButton = document.createElement("button");
            bootstrapButton.className = "primary-button";
            bootstrapButton.type = "button";
            bootstrapButton.textContent = "Verify Admin Access";
            bootstrapButton.addEventListener("click", async () => {
                bootstrapButton.disabled = true;
                try {
                    await getFirebaseBackend()?.bootstrapAdmin();
                    window.location.reload();
                } catch (error) {
                    window.showAppStatus?.(error.message || "This account is not authorized as an administrator.", true);
                    bootstrapButton.disabled = false;
                }
            });
            if (!adminDenied.querySelector("button")) adminDenied.appendChild(bootstrapButton);
        }
        return;
    }

    adminDenied.classList.remove("visible");
    adminDenied.hidden = true;
    adminContent.forEach((section) => {
        section.hidden = false;
    });

    const applicationList = document.querySelector("#admin-application-list");
    const userList = document.querySelector("#admin-user-list");
    const orderList = document.querySelector("#admin-order-list");

    function renderAdminDashboard() {
        const users = getUsers();
        const applications = getApplicationRecords().filter((application) => (
            !["draft", "cancelled", "expired"].includes(application.status)
        )).sort((a, b) => (
            new Date(b.submittedAt || 0) - new Date(a.submittedAt || 0)
        ));
        const orders = getOrders();
        const approvedPartners = users.filter((user) => {
            const roles = user.roles || [user.role || "customer"];
            return roles.includes("vendor") || roles.includes("rider");
        });
        const pendingApplications = applications.filter((item) => item.status === "pending" || item.reviewNeedsReconcile === true).length;

        const userCount = document.querySelector("#admin-user-count");
        const pendingCount = document.querySelector("#admin-pending-count");
        const orderCount = document.querySelector("#admin-order-count");
        const activePartnerCount = document.querySelector("#admin-active-partner-count");
        const reviewStatus = document.querySelector("#admin-review-status");
        if (userCount) userCount.textContent = users.length;
        if (pendingCount) pendingCount.textContent = pendingApplications;
        if (orderCount) orderCount.textContent = orders.length;
        if (activePartnerCount) activePartnerCount.textContent = approvedPartners.length;
        if (reviewStatus) {
            reviewStatus.textContent = pendingApplications ? "Needs review" : "No pending applications";
            reviewStatus.className = `status-badge ${pendingApplications ? "status-pending" : "status-delivered"}`;
        }

        if (applicationList) {
            applicationList.innerHTML = applications.length ? applications.map((application) => {
                const applicant = users.find((user) => user.userId === application.userId);
                const typeLabel = application.type === "cook" ? "Cook" : "Rider";
                const statusClass = application.status === "approved" ? "status-delivered" : application.status === "declined" ? "status-cancelled" : "status-pending";
                const details = application.fields || {};
                const documentNames = (application.documents || []).map((document) => document.name).join(", ") || "Document metadata unavailable";
                const documentButtons = (application.documents || []).map((document, index) => `
                    <button class="small-action-button" type="button" data-protected-field="${escapeHtml(document.field)}" data-application-id="${escapeHtml(application.id)}" data-file-label="${escapeHtml(document.name || `Document ${index + 1}`)}">View ${index + 1}</button>
                `).join("");
                const retryDecision = application.reviewNeedsReconcile === true ? application.reviewDecision : null;
                const controls = application.status === "pending" ? `
                    <div class="admin-review-actions">
                        <button class="small-action-button" type="button" data-admin-application-action="approve" data-application-id="${escapeHtml(application.id)}">Approve</button>
                        <button class="small-action-button cancelled-status-button" type="button" data-admin-application-action="decline" data-application-id="${escapeHtml(application.id)}">Decline</button>
                    </div>
                ` : retryDecision === "approved" || retryDecision === "declined" ? `
                    <div class="admin-review-actions">
                        <button class="small-action-button" type="button" data-admin-application-action="${retryDecision === "approved" ? "approve" : "decline"}" data-application-id="${escapeHtml(application.id)}">Retry ${retryDecision === "approved" ? "approval" : "rejection"}</button>
                    </div>
                ` : "";
                return `
                    <article class="admin-application-card">
                        <div class="admin-application-heading">
                            <div><strong>${escapeHtml(details.businessName || applicant?.fullName || "Applicant")}</strong><span>${typeLabel} - ${escapeHtml(application.reference || "No reference")}</span></div>
                            <span class="status-badge ${statusClass}">${escapeHtml(application.status || "pending")}</span>
                        </div>
                        <dl class="admin-application-details">
                            <div><dt>Applicant</dt><dd>${escapeHtml(applicant?.fullName || details.fullName || "Unknown")}</dd></div>
                            <div><dt>Contact</dt><dd>${escapeHtml(details.phone || applicant?.phone || "Not supplied")}</dd></div>
                            <div><dt>Area</dt><dd>${escapeHtml(details.serviceArea || details.location || applicant?.location || "Not supplied")}</dd></div>
                            <div><dt>Files checked</dt><dd>${escapeHtml(documentNames)}</dd></div>
                        </dl>
                        <div class="admin-review-actions" aria-label="Protected application documents">${documentButtons}</div>
                        <div class="application-upload-preview" data-protected-preview></div>
                        ${controls}
                    </article>
                `;
            }).join("") : '<p class="empty-state visible">No partner applications have been submitted.</p>';
        }

        if (userList) {
            userList.innerHTML = users.length ? users.map((user) => `
                <article class="dashboard-list-item">
                    <div><strong>${escapeHtml(user.fullName)}</strong><span>${escapeHtml(user.email || user.phone)} - ${(user.roles || [user.role || "customer"]).map(escapeHtml).join(", ")}</span></div>
                    <span class="status-badge status-delivered">Account</span>
                </article>
            `).join("") : '<p class="empty-state visible">No users yet.</p>';
        }

        if (orderList) {
            orderList.innerHTML = orders.length ? orders.slice(0, 10).map((order) => `
                <article class="dashboard-list-item">
                    <div><strong>${escapeHtml(order.id)}</strong><span>${escapeHtml(order.status)} - ${formatShillings(order.total)}</span></div>
                    <a class="text-action" href="order-tracking.html?order=${encodeURIComponent(order.id)}">View</a>
                </article>
            `).join("") : '<p class="empty-state visible">No orders have been placed.</p>';
        }
    }

    applicationList?.addEventListener("click", async (event) => {
        const fileButton = event.target.closest("[data-protected-field]");
        if (fileButton) {
            fileButton.disabled = true;
            try {
                const objectUrl = await getFirebaseBackend()?.loadProtectedImage(fileButton.dataset.applicationId, fileButton.dataset.protectedField);
                const preview = fileButton.closest(".admin-application-card")?.querySelector("[data-protected-preview]");
                if (preview && objectUrl) {
                    const image = document.createElement("img");
                    image.alt = fileButton.dataset.fileLabel || "Protected application document";
                    image.addEventListener("load", () => URL.revokeObjectURL(objectUrl), { once: true });
                    image.addEventListener("error", () => URL.revokeObjectURL(objectUrl), { once: true });
                    image.src = objectUrl;
                    preview.replaceChildren(image);
                }
            } catch (error) {
                window.showAppStatus?.(error.message || "The protected file could not be opened.", true);
            } finally {
                fileButton.disabled = false;
            }
            return;
        }

        const actionButton = event.target.closest("[data-admin-application-action]");
        if (!actionButton) {
            return;
        }

        const applicationId = actionButton.dataset.applicationId;
        const application = getApplicationRecords().find((item) => item.id === applicationId);
        if (!application) {
            window.showAppStatus?.("Application could not be found.", true);
            return;
        }

        const approved = actionButton.dataset.adminApplicationAction === "approve";
        actionButton.disabled = true;
        try {
            await getFirebaseBackend()?.reviewApplication(applicationId, approved ? "approved" : "declined");
            renderAdminDashboard();
            window.showAppStatus?.(approved ? `${application.type === "cook" ? "Cook" : "Rider"} application approved.` : "Application declined.");
        } catch (error) {
            window.showAppStatus?.(error.message || "The application could not be reviewed.", true);
        } finally {
            actionButton.disabled = false;
        }
    });

    renderAdminDashboard();
}

function hasApprovedPartnerApplication(type) {
    const profile = getActiveProfile();
    if (!profile) {
        return false;
    }
    return type === "cook" ? userHasRole(profile, "vendor") : userHasRole(profile, "rider");
}

function initVendorDashboard() {
    const vendorDashboard = document.querySelector("[data-vendor-dashboard]");
    const vendorDenied = document.querySelector("#vendor-denied");
    const vendorContent = Array.from(document.querySelectorAll(".vendor-content"));

    if (!vendorDashboard || !vendorDenied) {
        return;
    }

    if (!hasApprovedPartnerApplication("cook")) {
        vendorDenied.classList.add("visible");
        vendorContent.forEach((section) => {
            section.hidden = true;
        });
        return;
    }

    vendorDenied.classList.remove("visible");
    vendorDenied.hidden = true;
    vendorContent.forEach((section) => {
        section.hidden = false;
    });
}

function initRiderDashboard() {
    const riderDashboard = document.querySelector("[data-rider-dashboard]");
    const riderDenied = document.querySelector("#rider-denied");
    const riderContent = Array.from(document.querySelectorAll(".rider-content"));

    if (!riderDashboard || !riderDenied) {
        return;
    }

    if (!hasApprovedPartnerApplication("rider")) {
        riderDenied.classList.add("visible");
        riderContent.forEach((section) => {
            section.hidden = true;
        });
        return;
    }

    riderDenied.classList.remove("visible");
    riderDenied.hidden = true;
    riderContent.forEach((section) => {
        section.hidden = false;
    });
}

function initApplicationForms() {
    document.querySelectorAll("[data-application-form]").forEach((form) => {
        const type = form.dataset.applicationForm;
        const profile = getActiveProfile();
        const gate = document.querySelector("[data-application-auth-gate]");
        const currentPage = window.location.pathname.split("/").pop() || `${type === "cook" ? "apply-cook" : "apply-rider"}.html`;

        if (!profile) {
            form.hidden = true;
            if (gate) {
                gate.hidden = false;
                const returnTarget = encodeURIComponent(currentPage);
                const registerLink = gate.querySelector("[data-register-return]");
                const loginLink = gate.querySelector("[data-login-return]");
                if (registerLink) registerLink.href = `register.html?returnTo=${returnTarget}`;
                if (loginLink) loginLink.href = `login.html?returnTo=${returnTarget}`;
            }
            return;
        }

        form.hidden = false;
        if (gate) gate.hidden = true;

        ["fullName", "phone", "email", "location"].forEach((fieldName) => {
            if (form.elements[fieldName] && !form.elements[fieldName].value) {
                form.elements[fieldName].value = profile[fieldName] || "";
            }
        });

        form.querySelectorAll("[data-application-upload]").forEach((block) => {
            const input = block.querySelector('input[type="file"]');
            const confirmation = block.querySelector("[data-upload-confirm]");
            input?.addEventListener("change", () => validateApplicationUploadBlock(block, false));
            confirmation?.addEventListener("change", () => {
                if (input?.files?.length) validateApplicationUploadBlock(block, false);
            });
        });

        form.addEventListener("submit", async (event) => {
            event.preventDefault();

            const message = form.querySelector("[data-application-message]");
            const submitButton = form.querySelector(".application-submit-button");

            function showApplicationMessage(text, isError = false) {
                if (!message) return;
                message.textContent = text;
                message.hidden = false;
                message.classList.toggle("error", isError);
            }

            if (!form.checkValidity()) {
                form.reportValidity();
                showApplicationMessage("Please complete every required field and confirmation.", true);
                return;
            }

            const phone = form.elements.phone?.value.trim() || "";
            if (phone.replace(/\D/g, "").length < 7) {
                form.elements.phone.focus();
                showApplicationMessage("Enter a valid phone number so the team can reach you.", true);
                return;
            }

            if (getFirebaseState().user?.emailVerified !== true) {
                showApplicationMessage("Verify your email address before submitting a partner application.", true);
                return;
            }

            const uploadBlocks = Array.from(form.querySelectorAll("[data-application-upload]"));
            for (const block of uploadBlocks) {
                const result = await validateApplicationUploadBlock(block, true);
                if (!result) {
                    block.scrollIntoView({ behavior: "smooth", block: "center" });
                    showApplicationMessage("Please fix the highlighted upload before submitting.", true);
                    return;
                }
            }

            submitButton.disabled = true;
            submitButton.classList.add("is-loading");
            submitButton.textContent = "Submitting application...";
            showApplicationMessage("Checking your application and preparing a reference number.");

            try {
                const fields = collectApplicationFields(form);
                const result = await getFirebaseBackend().submitApplication(type, fields, uploadBlocks);
                window.location.href = `application-confirmation.html?type=${encodeURIComponent(type)}&ref=${encodeURIComponent(result.reference)}`;
            } catch (error) {
                showApplicationMessage(error.message || "The application could not be saved. Please try again.", true);
                submitButton.disabled = false;
                submitButton.classList.remove("is-loading");
                submitButton.textContent = type === "cook" ? "Submit Kitchen Application" : "Submit Rider Application";
            }
        });
    });
}

function showApplicationUploadResult(block, message, isError = false) {
    const result = block.querySelector("[data-upload-result]");
    if (!result) return;
    result.textContent = message;
    result.hidden = false;
    result.classList.toggle("error", isError);
    result.classList.toggle("success", !isError);
    block.classList.toggle("has-error", isError);
    block.classList.toggle("is-valid", !isError);
}

async function validateApplicationUploadBlock(block, requireConfirmation = true) {
    const input = block.querySelector('input[type="file"]');
    const file = input?.files?.[0];
    const kind = block.dataset.kind || "document";
    const confirmation = block.querySelector("[data-upload-confirm]");
    const preview = block.querySelector("[data-upload-preview]");

    if (!file) {
        showApplicationUploadResult(block, "Choose a file to continue.", true);
        return null;
    }

    if (!imageUploadRules.allowedTypes.includes(file.type)) {
        showApplicationUploadResult(block, "Use a JPG, PNG, or WebP image.", true);
        input.value = "";
        return null;
    }
    if (file.size > imageUploadRules.maxBytes) {
        showApplicationUploadResult(block, "This image is over 2MB. Choose a smaller image.", true);
        input.value = "";
        return null;
    }

    try {
        const image = await readImageFile(file);
        if (image.width < imageUploadRules.minWidth || image.height < imageUploadRules.minHeight) {
            showApplicationUploadResult(block, `Image is ${image.width}x${image.height}px. Minimum size is 800x600px.`, true);
            input.value = "";
            if (preview) preview.innerHTML = "";
            return null;
        }
        if (!aspectRatioIsAllowed(image.width, image.height)) {
            showApplicationUploadResult(block, "Crop the image to square 1:1 or landscape 4:3.", true);
            input.value = "";
            if (preview) preview.innerHTML = "";
            return null;
        }
        if (requireConfirmation && confirmation && !confirmation.checked) {
            showApplicationUploadResult(block, "Tick the confirmation after checking the image is clear and complete.", true);
            return null;
        }
        if (preview) preview.innerHTML = `<img src="${image.dataUrl}" alt="Selected ${escapeHtml(kind)} upload preview">`;
        const confirmationHint = confirmation && !confirmation.checked ? " Technical checks passed; tick the confirmation before submitting." : " Ready to submit.";
        showApplicationUploadResult(block, `${file.name} passed size, resolution, and shape checks.${confirmationHint}`);
        return {
            field: input.name,
            name: file.name,
            type: file.type,
            size: file.size,
            width: image.width,
            height: image.height,
            checkedLocally: true,
            declarationConfirmed: Boolean(confirmation?.checked)
        };
    } catch (error) {
        showApplicationUploadResult(block, error.message || "We could not read this image.", true);
        input.value = "";
        return null;
    }
}

function formatFileSize(bytes) {
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function collectApplicationFields(form) {
    const fields = {};
    Array.from(form.elements).forEach((element) => {
        if (!element.name || element.type === "file" || element.type === "submit" || element.name === "consent") return;
        fields[element.name] = element.type === "checkbox" ? element.checked : element.value.trim();
    });
    return fields;
}

function initApplicationConfirmation() {
    const page = document.querySelector("[data-application-confirmation]");
    if (!page) return;

    const params = new URLSearchParams(window.location.search);
    const expectedReference = params.get("ref");
    const expectedType = params.get("type");
    const profile = getActiveProfile();
    const confirmation = getApplicationRecords().find((application) => (
        application.reference === expectedReference
        && application.type === expectedType
        && application.userId === profile?.userId
    ));
    if (!confirmation) {
        document.querySelector("#application-confirmation-title").textContent = "No recent application found";
        document.querySelector("#application-confirmation-message").textContent = "Return to your account to start or review an application.";
        document.querySelector("#application-confirmation-status").textContent = "Not found";
        document.querySelector(".confirmation-check").textContent = "?";
        document.querySelector(".confirmation-next-card").hidden = true;
        document.querySelector("#application-integration-notice").hidden = true;
        return;
    }

    document.querySelector("#application-confirmation-type").textContent = confirmation.type === "cook" ? "Kitchen partner" : "Rider partner";
    document.querySelector("#application-confirmation-reference").textContent = confirmation.reference;
    document.querySelector("#application-confirmation-date").textContent = new Date(confirmation.submittedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
    document.querySelector("#application-confirmation-email").textContent = "Email notification not configured";
    document.querySelector("#application-confirmation-title").textContent = "Application submitted securely";
    document.querySelector("#application-confirmation-message").textContent = "Thank you. Your application and documents were securely submitted for admin review.";
    document.querySelector("#application-confirmation-status").textContent = confirmation.status === "pending" ? "Pending review" : confirmation.status;

    const notice = document.querySelector("#application-integration-notice");
    notice.classList.add("remote-submission");
    notice.innerHTML = "<strong>Secure submission received</strong><p>Your application is stored in Firebase and can only be reviewed by an authorized administrator. Email delivery requires a separate provider.</p>";
}

function initGlobalPrototypeActions() {
    document.addEventListener("click", (event) => {
        const placeholderButton = event.target.closest("[data-placeholder-alert]");
        if (placeholderButton) {
            event.preventDefault();
            alert(placeholderButton.dataset.placeholderAlert);
            return;
        }

        const notificationButton = event.target.closest(".notification-button");
        if (notificationButton) {
            event.preventDefault();
            alert("Notifications and promotional offers will appear here soon.");
            return;
        }

        const deleteButton = event.target.closest("[data-delete-item]");
        if (deleteButton) {
            deleteButton.closest(".mini-list-item").remove();
        }
    });

    const logoutButton = document.querySelector("#logout-button");
    if (logoutButton) {
        logoutButton.addEventListener("click", async () => {
            try {
                await clearActiveAccount();
                window.location.href = "login.html";
            } catch (error) {
                window.showAppStatus?.(error.message || "Could not sign out.", true);
            }
        });
    }
}

function initAuthHeader() {
    const authActions = Array.from(document.querySelectorAll("[data-auth-actions]"));
    const authWelcomes = Array.from(document.querySelectorAll("[data-auth-welcome]"));
    const publicOnlySections = Array.from(document.querySelectorAll("[data-public-only]"));

    if (!authActions.length && !authWelcomes.length && !publicOnlySections.length) {
        return;
    }

    const profile = getActiveProfile();
    if (!profile) {
        authActions.forEach((group) => {
            group.hidden = false;
        });
        authWelcomes.forEach((welcome) => {
            welcome.hidden = true;
            welcome.textContent = "";
        });
        publicOnlySections.forEach((section) => {
            section.hidden = false;
        });
        return;
    }

    const firstName = (profile.fullName || "there").trim().split(/\s+/)[0];
    authActions.forEach((group) => {
        group.hidden = true;
    });
    authWelcomes.forEach((welcome) => {
        welcome.hidden = false;
        welcome.textContent = `Hi, ${firstName}`;
    });
    publicOnlySections.forEach((section) => {
        section.hidden = true;
    });
}

function initNotificationButtons() {
    document.querySelectorAll(".app-header, .checkout-header").forEach((header) => {
        if (header.querySelector(".notification-button")) {
            return;
        }

        const button = document.createElement("button");
        button.className = "notification-button";
        button.type = "button";
        button.setAttribute("aria-label", "Notifications and promotional offers");
        button.innerHTML = "&#128276;";

        const welcome = header.querySelector("[data-auth-welcome]");
        const authActions = header.querySelector("[data-auth-actions]");
        const reference = welcome || authActions;
        const parent = reference?.parentElement || header;
        if (welcome) {
            parent.insertBefore(button, welcome);
        } else if (authActions) {
            parent.insertBefore(button, authActions);
        } else {
            header.appendChild(button);
        }
    });
}

function initGlobalFeedback() {
    const statusRegion = document.createElement("div");
    statusRegion.className = "app-status-region";
    statusRegion.setAttribute("aria-live", "polite");
    statusRegion.hidden = true;
    document.body.appendChild(statusRegion);

    function showStatus(message, isError = false) {
        statusRegion.textContent = message;
        statusRegion.hidden = false;
        statusRegion.classList.toggle("error", isError);
        setTimeout(() => {
            statusRegion.hidden = true;
        }, 3500);
    }

    window.showAppStatus = showStatus;

    window.addEventListener("error", () => {
        showStatus("Something went wrong. Please try again.", true);
    });

    window.addEventListener("unhandledrejection", () => {
        showStatus("Unable to complete that action right now.", true);
    });
}

function initOrderHistoryPage() {
    const orderList = document.querySelector("#order-history-list");
    const emptyState = document.querySelector("#order-empty-state");

    if (!orderList || !emptyState) {
        return;
    }

    function getStatusClass(status) {
        const normalized = String(status || "pending").toLowerCase();
        if (normalized.includes("cancelled")) return "status-cancelled";
        if (normalized.includes("delivered")) return "status-delivered";
        if (normalized.includes("out for delivery")) return "status-delivery";
        if (normalized.includes("preparing")) return "status-preparing";
        return "status-pending";
    }

    function getStatusStyle(status) {
        const normalized = String(status || "pending").toLowerCase();
        if (normalized.includes("cancelled")) return "background:#f8e9e7;color:#9a2d23;";
        if (normalized.includes("delivered")) return "background:#f1f3f5;color:#263029;";
        if (normalized.includes("out for delivery")) return "background:#eef7ef;color:#225a26;";
        if (normalized.includes("preparing")) return "background:#fff8d6;color:#7a6100;";
        return "";
    }

    function renderOrders() {
        const orders = getOrdersForActiveAccount();
        orderList.innerHTML = "";
        orderList.style.display = orders.length ? "grid" : "none";
        orderList.style.gap = "16px";
        emptyState.classList.toggle("visible", orders.length === 0);

        orders.forEach((order) => {
            const card = document.createElement("article");
            const orderDate = order.createdAt || order.timestamp || order.dateTime || order.date;
            const formattedDate = orderDate
                ? new Date(orderDate).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })
                : "Date unavailable";
            card.className = "order-card";
            card.dataset.orderId = order.id;
            card.innerHTML = `
                <div class="order-topline">
                    <div>
                        <h2>Order ${order.id}</h2>
                        <p>${escapeHtml(formattedDate)}</p>
                    </div>
                    <span class="status-badge ${getStatusClass(order.status)}" style="${getStatusStyle(order.status)}">${escapeHtml(order.status)}</span>
                </div>
                <p class="support-copy"><strong>Delivery address:</strong> ${escapeHtml(order.deliveryAddress)}</p>
                <p class="support-copy"><strong>Payment method:</strong> ${escapeHtml(order.paymentMethod)}</p>
                <div class="order-items">
                    ${order.items.map((item) => `
                        <div class="order-item" data-name="${escapeHtml(item.name)}" data-price="${Number(item.price)}" data-image="${escapeHtml(item.image)}" data-quantity="${Number(item.quantity || 1)}">
                            <img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}">
                            <span>${escapeHtml(item.name)} x ${Number(item.quantity || 1)} - ${formatShillings(item.price * (item.quantity || 1))}</span>
                        </div>
                    `).join("")}
                </div>
                <div class="order-breakdown">
                    <div><span>Subtotal</span><strong>${formatShillings(order.subtotal || 0)}</strong></div>
                    <div><span>Delivery fee</span><strong>${formatShillings(order.deliveryFee || deliveryFee)}</strong></div>
                    <div><span>Total</span><strong>${formatShillings(order.total)}</strong></div>
                </div>
                <div class="order-footer">
                    <strong>Order total: ${formatShillings(order.total)}</strong>
                    <div>
                        <a class="small-action-button track-order-button" href="order-tracking.html?order=${encodeURIComponent(order.id)}">Track Order</a>
                        <button class="small-action-button reorder-button" type="button">Reorder</button>
                        <button class="small-action-button review-button" type="button">Leave Review</button>
                    </div>
                </div>
            `;
            orderList.appendChild(card);
        });
    }

    orderList.addEventListener("click", (event) => {
        const reorderButton = event.target.closest(".reorder-button");
        const reviewButton = event.target.closest(".review-button");
        if (reorderButton) {
            const orderCard = reorderButton.closest(".order-card");
            const order = getOrdersForActiveAccount().find((entry) => entry.id === orderCard.dataset.orderId);
            const items = order?.items || [];

            let updated = true;
            for (const item of items) {
                const quantity = Number(item.quantity || 1);
                for (let count = 0; count < quantity; count += 1) {
                    if (!addItemToCart({
                        name: item.name,
                        price: Number(item.price),
                        image: item.image,
                        baseName: item.baseName,
                        addOns: item.addOns || [],
                        menuItemId: item.menuItemId,
                        vendorOwnerId: item.vendorOwnerId,
                        shopId: item.shopId
                    })) {
                        updated = false;
                        break;
                    }
                }
                if (!updated) break;
            }

            if (updated) {
                alert("Order items added to your cart.");
                window.location.href = "cart.html";
            }
        }

        if (reviewButton) {
            const orderId = reviewButton.closest(".order-card").dataset.orderId;
            alert(`Review form for ${orderId} will be connected later.`);
        }
    });

    renderOrders();
}

function initOrderTrackingPage() {
    const trackingRoot = document.querySelector("[data-order-tracking]");
    const emptyState = document.querySelector("#tracking-empty-state");
    const trackingContent = document.querySelector(".tracking-content");

    if (!trackingRoot || !emptyState || !trackingContent) {
        return;
    }

    const order = findOrderForTracking();
    if (!order) {
        emptyState.classList.add("visible");
        trackingContent.hidden = true;
        return;
    }

    const normalizedStatus = (order.status || "").toLowerCase();
    const activeStep = normalizedStatus.includes("delivered")
        ? "delivered"
        : normalizedStatus.includes("out for delivery")
            ? "out"
            : normalizedStatus.includes("preparing")
                ? "preparing"
                : "confirmed";
    const stepOrder = ["confirmed", "preparing", "out", "delivered"];
    const activeIndex = stepOrder.indexOf(activeStep);
    const etaByStep = {
        confirmed: "40-50 min",
        preparing: "30-40 min",
        out: "10-20 min",
        delivered: "Delivered"
    };

    emptyState.classList.remove("visible");
    emptyState.hidden = true;
    trackingContent.hidden = false;

    document.querySelector("#tracking-order-id").textContent = `Order ${order.id}`;
    const orderDate = order.createdAt || order.timestamp || order.dateTime;
    document.querySelector("#tracking-order-meta").textContent = orderDate
        ? new Date(orderDate).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })
        : "Order time pending";
    document.querySelector("#tracking-status").textContent = order.status || "Confirmed";
    document.querySelector("#tracking-eta").textContent = etaByStep[activeStep];
    document.querySelector("#tracking-vendor-name").textContent = getVendorNameForOrder(order);
    document.querySelector("#tracking-total").textContent = formatShillings(order.total || 0);
    document.querySelector("#tracking-address").textContent = order.deliveryAddress || "Pending";

    const assignedRider = getUsers().find((user) => user.userId === order.assignedRiderId);
    const riderName = document.querySelector("#tracking-rider-name");
    const riderPhone = document.querySelector("#tracking-rider-phone");
    const riderVehicle = document.querySelector("#tracking-rider-vehicle");
    if (riderName) riderName.textContent = assignedRider?.fullName || order.riderName || "Assigned shortly";
    if (riderPhone) riderPhone.textContent = assignedRider?.phone || order.riderPhone || "Pending";
    if (riderVehicle) riderVehicle.textContent = order.riderVehicle || "Pending assignment";

    document.querySelectorAll(".tracking-step").forEach((step) => {
        const stepIndex = stepOrder.indexOf(step.dataset.step);
        step.classList.toggle("active", stepIndex <= activeIndex);
        step.classList.toggle("current", stepIndex === activeIndex);
    });
}

function initHomePage() {
    const vendors = Array.from(document.querySelectorAll(".vendor-card"));
    const popularMealCards = Array.from(document.querySelectorAll(".popular-meal-card"));
    const popularMealsSection = document.querySelector(".popular-meals-section");
    const searchInput = document.querySelector("#meal-search");
    const categoryButtons = Array.from(document.querySelectorAll(".category-chip"));
    const resultCount = document.querySelector("#result-count");
    const emptyState = document.querySelector("#empty-state");
    const searchAction = document.querySelector("#search-action");
    const searchClear = document.querySelector("#search-clear");
    const cartBar = document.querySelector("#cart-bar");
    const cartCount = document.querySelector("#cart-count");
    const cartLatest = document.querySelector("#cart-latest");
    const cartTotal = document.querySelector("#cart-total");
    const promoTrack = document.querySelector("#promo-track");
    const promoDots = Array.from(document.querySelectorAll(".promo-dot"));
    const pickupFilter = document.querySelector("#filter-pickup");
    const openNowFilter = document.querySelector("#filter-open-now");
    const offersFilter = document.querySelector("#filter-offers");
    const cuisineFilter = document.querySelector("#filter-cuisine");
    const minOrderFilter = document.querySelector("#filter-min-order");
    const minOrderValue = document.querySelector("#filter-min-order-value");
    const bestSellerFilter = document.querySelector("#filter-best-seller");
    const fastDeliveryFilter = document.querySelector("#filter-fast-delivery");
    const feeFilter = document.querySelector("#filter-fee");
    const feeValue = document.querySelector("#filter-fee-value");
    const timeFilter = document.querySelector("#filter-time");
    const timeValue = document.querySelector("#filter-time-value");
    const ratingFilter = document.querySelector("#filter-rating");
    const priceFilter = document.querySelector("#filter-price");
    const sortFilter = document.querySelector("#filter-sort");
    const locationButton = document.querySelector(".location-selector");
    const locationPanel = document.querySelector("#location-panel");
    const locationName = document.querySelector("#selected-location");
    const locationSearch = document.querySelector("#location-search");
    const saveLocationButton = document.querySelector("#save-location");
    const currentLocationButton = document.querySelector("#use-current-location");
    const filterToggle = document.querySelector("#filter-toggle");
    const filterPanel = document.querySelector("#vendor-filters");

    if (!vendors.length) {
        return;
    }

    let activeCategory = "All";
    let promoIndex = 0;

    function updateLocationDisplay() {
        const location = getSelectedLocation();
        if (locationName) {
            locationName.textContent = location;
        }
        if (locationSearch) {
            locationSearch.value = location === "Nairobi, Kenya" ? "" : location;
        }
    }

    function updateVendorDeliveryMeta() {
        const location = getSelectedLocation();
        vendors.forEach((vendor) => {
            const info = getVendorDeliveryInfo(vendor, location);
            const timeMeta = vendor.querySelector("[data-delivery-time]");
            const feeMeta = vendor.querySelector("[data-delivery-fee]");
            if (timeMeta) {
                timeMeta.textContent = `${info.minTime}-${info.maxTime} min`;
            }
            if (feeMeta) {
                feeMeta.textContent = `${formatShillings(info.fee)} delivery`;
            }
            vendor.dataset.locationFee = String(info.fee);
            vendor.dataset.locationTime = String(info.maxTime);
        });
    }

    function setDeliveryLocation(location) {
        const cleanLocation = (location || "").trim();
        if (!cleanLocation) {
            alert("Please enter an estate, street, or area name.");
            return;
        }
        saveSelectedLocation(cleanLocation);
        updateLocationDisplay();
        updateVendorDeliveryMeta();
        applyFilters();
        if (locationPanel) {
            locationPanel.hidden = true;
        }
    }

    function updateHomeCartBar(items = getCart(), latestName = "") {
        const { itemCount, total } = getCartTotals(items);
        cartCount.textContent = `${itemCount} ${itemCount === 1 ? "item" : "items"}`;
        cartLatest.textContent = latestName ? `Added ${latestName}` : "Ready when you are";
        cartTotal.textContent = formatShillings(total);
        cartBar.classList.toggle("visible", itemCount > 0);
    }

    // Home search stays local for now; this can later call Firebase search indexes.
    function applyFilters() {
        const query = normalizeSearchText(searchInput.value);
        const openOnly = Boolean(openNowFilter?.checked);
        const pickupOnly = Boolean(pickupFilter?.checked);
        const offersOnly = Boolean(offersFilter?.checked);
        const cuisine = cuisineFilter?.value || "all";
        const maxMinimumOrder = Number(minOrderFilter?.value || 9999);
        const bestSellerOnly = Boolean(bestSellerFilter?.checked);
        const fastDeliveryOnly = Boolean(fastDeliveryFilter?.checked);
        const maxFee = Number(feeFilter?.value || 9999);
        const maxTime = Number(timeFilter?.value || 9999);
        const minRating = Number(ratingFilter?.value || 0);
        const maxPrice = Number(priceFilter?.value || 9999);
        const sortMode = sortFilter?.value || "recommended";
        let visibleCount = 0;
        const sortedVendors = [...vendors].sort((a, b) => {
            if (sortMode === "rating") {
                return Number(b.dataset.rating || 0) - Number(a.dataset.rating || 0);
            }

            if (sortMode === "fastest") {
                return Number(a.dataset.locationTime || a.dataset.time || 9999) - Number(b.dataset.locationTime || b.dataset.time || 9999);
            }

            return vendors.indexOf(a) - vendors.indexOf(b);
        });

        sortedVendors.forEach((vendor) => {
            vendor.parentElement.appendChild(vendor);
        });

        vendors.forEach((vendor) => {
            const name = normalizeSearchText(vendor.dataset.name);
            const keywords = normalizeSearchText(vendor.dataset.keywords);
            const description = normalizeSearchText(vendor.querySelector(".vendor-details p").textContent);
            const menuSearchText = normalizeSearchText(getVendorSearchText(vendor.dataset.vendorId));
            const matchesSearch = !query || name.includes(query) || description.includes(query) || keywords.includes(query) || menuSearchText.includes(query);
            const matchesCategory = activeCategory === "All" || keywords.includes(activeCategory.toLowerCase());
            const matchesCuisine = cuisine === "all" || vendor.dataset.cuisine === cuisine;
            const matchesMinimumOrder = Number(vendor.dataset.minOrder || 0) <= maxMinimumOrder;
            const matchesBestSeller = !bestSellerOnly || vendor.dataset.bestSeller === "true";
            const matchesFastDelivery = !fastDeliveryOnly || vendor.dataset.fastDelivery === "true";
            const matchesOpen = !openOnly || vendor.dataset.open === "true";
            const matchesPickup = !pickupOnly || vendor.dataset.pickup === "true";
            const matchesOffers = !offersOnly || vendor.dataset.offers === "true";
            const matchesFee = Number(vendor.dataset.locationFee || vendor.dataset.fee || 0) <= maxFee;
            const matchesTime = Number(vendor.dataset.locationTime || vendor.dataset.time || 0) <= maxTime;
            const matchesRating = Number(vendor.dataset.rating || 0) >= minRating;
            const matchesPrice = Number(vendor.dataset.price || 0) <= maxPrice;
            const isVisible = matchesSearch && matchesCategory && matchesCuisine && matchesMinimumOrder && matchesBestSeller && matchesFastDelivery && matchesOpen && matchesPickup && matchesOffers && matchesFee && matchesTime && matchesRating && matchesPrice;

            vendor.classList.toggle("hidden", !isVisible);
            if (isVisible) {
                visibleCount += 1;
            }
        });

        let visiblePopularMealCount = 0;
        popularMealCards.forEach((card) => {
            const matchesSearch = !query || normalizeSearchText(card.textContent).includes(query);
            card.hidden = !matchesSearch;
            if (matchesSearch) {
                visiblePopularMealCount += 1;
            }
        });
        if (popularMealsSection) {
            popularMealsSection.hidden = Boolean(query) && visiblePopularMealCount === 0;
        }

        resultCount.textContent = `${visibleCount} nearby`;
        emptyState.classList.toggle("visible", visibleCount === 0);
        searchClear.hidden = query.length === 0;
        if (feeValue && feeFilter) {
            feeValue.textContent = `Up to KSh ${feeFilter.value}`;
        }
        if (timeValue && timeFilter) {
            timeValue.textContent = `Up to ${timeFilter.value} min`;
        }
        if (minOrderValue && minOrderFilter) {
            minOrderValue.textContent = `Up to KSh ${minOrderFilter.value}`;
        }
    }

    function runSearch() {
        applyFilters();
        document.querySelector("#vendor-list").scrollIntoView({ behavior: "smooth", block: "start" });
    }

    categoryButtons.forEach((button) => {
        button.addEventListener("click", () => {
            categoryButtons.forEach((chip) => {
                chip.classList.remove("active");
                chip.setAttribute("aria-pressed", "false");
            });
            button.classList.add("active");
            button.setAttribute("aria-pressed", "true");
            activeCategory = button.dataset.category;
            applyFilters();
        });
    });

    searchInput.addEventListener("input", applyFilters);
    searchInput.addEventListener("search", applyFilters);
    searchInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            runSearch();
        }
    });

    searchAction.addEventListener("click", runSearch);

    searchClear.addEventListener("click", () => {
        searchInput.value = "";
        categoryButtons.forEach((chip) => {
            chip.classList.remove("active");
            chip.setAttribute("aria-pressed", "false");
        });
        categoryButtons[0].classList.add("active");
        categoryButtons[0].setAttribute("aria-pressed", "true");
        activeCategory = "All";
        applyFilters();
        searchInput.focus();
    });

    if (filterToggle && filterPanel) {
        filterToggle.addEventListener("click", () => {
            const isOpen = filterPanel.classList.toggle("is-open");
            filterToggle.setAttribute("aria-expanded", String(isOpen));
        });
    }

    [openNowFilter, pickupFilter, offersFilter, cuisineFilter, minOrderFilter, bestSellerFilter, fastDeliveryFilter, feeFilter, timeFilter, ratingFilter, priceFilter, sortFilter].filter(Boolean).forEach((control) => {
        control.addEventListener("input", applyFilters);
        control.addEventListener("change", applyFilters);
    });

    if (locationButton && locationPanel) {
        locationButton.addEventListener("click", () => {
            locationPanel.hidden = !locationPanel.hidden;
            if (!locationPanel.hidden) {
                locationSearch?.focus();
            }
        });
    }

    if (saveLocationButton) {
        saveLocationButton.addEventListener("click", () => {
            setDeliveryLocation(locationSearch?.value || "");
        });
    }

    if (locationSearch) {
        locationSearch.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                setDeliveryLocation(locationSearch.value);
            }
        });
    }

    if (currentLocationButton) {
        currentLocationButton.addEventListener("click", () => {
            setDeliveryLocation("Current Location");
        });
    }

    document.querySelectorAll("[data-location-suggestion]").forEach((button) => {
        button.addEventListener("click", () => {
            setDeliveryLocation(button.dataset.locationSuggestion);
        });
    });

    vendors.forEach((vendor) => {
        function openShop() {
            window.location.href = `shop.html?vendor=${encodeURIComponent(vendor.dataset.vendorId)}`;
        }

        vendor.addEventListener("click", (event) => {
            if (event.target.closest("button")) {
                return;
            }
            openShop();
        });

        vendor.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openShop();
            }
        });
    });

    cartBar.addEventListener("click", () => {
        window.location.href = "cart.html";
    });

    function showPromo(index) {
        promoIndex = index;
        promoTrack.style.transform = `translateX(-${promoIndex * 100}%)`;
        promoDots.forEach((dot, dotIndex) => {
            dot.classList.toggle("active", dotIndex === promoIndex);
        });
    }

    setInterval(() => {
        showPromo((promoIndex + 1) % promoDots.length);
    }, 4500);

    updateLocationDisplay();
    updateVendorDeliveryMeta();
    applyFilters();
    updateHomeCartBar();
}

function initShopPage() {
    const shopHero = document.querySelector("#shop-hero");
    const shopMenu = document.querySelector("#shop-menu");
    const shopTitle = document.querySelector("#shop-title");
    const cartBar = document.querySelector("#cart-bar");
    const cartCount = document.querySelector("#cart-count");
    const cartLatest = document.querySelector("#cart-latest");
    const cartTotal = document.querySelector("#cart-total");

    if (!shopHero || !shopMenu || !shopTitle) {
        return;
    }

    const params = new URLSearchParams(window.location.search);
    const vendorId = params.get("vendor") || "bibis";
    const shop = vendorShops[vendorId] || getMarketplaceShop(vendorId)
        || (vendorId.startsWith("partner-") ? null : vendorShops.bibis);
    if (!shop) {
        shopTitle.textContent = "Shop unavailable";
        shopHero.innerHTML = '<p class="empty-state visible">This kitchen is not available right now. Browse other meals on the home page.</p>';
        shopMenu.replaceChildren();
        return;
    }

    function updateShopCartBar(items = getCart(), latestName = "") {
        const { itemCount, total } = getCartTotals(items);
        cartCount.textContent = `${itemCount} ${itemCount === 1 ? "item" : "items"}`;
        cartLatest.textContent = latestName ? `Added ${latestName}` : "Ready when you are";
        cartTotal.textContent = formatShillings(total);
        cartBar.classList.toggle("visible", itemCount > 0);
    }

    shopTitle.textContent = shop.name;
    shopHero.innerHTML = `
        <img src="${escapeHtml(shop.image)}" alt="${escapeHtml(shop.name)}">
        <div class="shop-hero-copy">
            <div class="vendor-title-row">
                <img class="vendor-logo" src="${escapeHtml(shop.logo)}" alt="${escapeHtml(shop.name)} logo">
                <div>
                    <h2>${escapeHtml(shop.name)}</h2>
                    <p>${escapeHtml(shop.description)}</p>
                </div>
            </div>
            <div class="vendor-meta detail-meta">
                <span class="${shop.isOpen ? "open-status" : "closed-status"}">${shop.isOpen ? "Open" : "Closed"}</span>
                <span>${escapeHtml(shop.openingHours)}</span>
                <span>${escapeHtml(shop.meta)}</span>
                <span>${shop.rating == null ? "New kitchen" : `${shop.rating.toFixed(1)} stars (${shop.reviewCount} reviews)`}</span>
            </div>
            <div class="vendor-detail-grid">
                <div><strong>Service area</strong><span>${escapeHtml(shop.serviceArea)}</span></div>
                <div><strong>About</strong><span>${escapeHtml(shop.about)}</span></div>
            </div>
            ${shop.isPartner ? "" : '<p class="support-copy">Sample menu for browsing. Ordering opens when an approved kitchen publishes its menu.</p>'}
        </div>
    `;

    shopMenu.innerHTML = Object.entries(shop.categories).filter(([, items]) => items.length).map(([category, items]) => `
        <section class="checkout-panel menu-category">
            <div class="section-heading">
                <h2>${escapeHtml(category)}</h2>
                <span>${items.length} items</span>
            </div>
            <div class="menu-item-list">
                ${items.map((item) => {
                    const itemDetails = getDishDetails({ ...item, category }, shop);
                    const dishReference = item.menuItemId || slugify(item.name);
                    const dishUrl = `dish.html?vendor=${encodeURIComponent(vendorId)}&dish=${encodeURIComponent(dishReference)}`;
                    return `
                    <article class="menu-item">
                        <a class="menu-item-photo" href="${dishUrl}" aria-label="View ${escapeHtml(item.name)}">
                            <img src="${escapeHtml(itemDetails.photo)}" alt="${escapeHtml(item.name)}">
                        </a>
                        <div class="menu-item-copy">
                            <div>
                                <a class="menu-item-link" href="${dishUrl}">
                                    <h3>${escapeHtml(item.name)}</h3>
                                </a>
                                <p>${escapeHtml(item.description)}</p>
                                <strong>${formatShillings(item.price)}</strong>
                            </div>
                            <div class="menu-actions">
                                <a class="dish-details-button" href="${dishUrl}">View Details</a>
                                ${shop.isPartner ? `<button class="menu-add-button" type="button" data-name="${escapeHtml(item.name)}" data-price="${item.price}" data-image="${escapeHtml(itemDetails.photo)}" data-menu-item-id="${escapeHtml(item.menuItemId || "")}" ${shop.isOpen ? "" : "disabled"}>${shop.isOpen ? "Add to Cart" : "Not accepting orders"}</button>` : '<span class="support-copy">Sample menu only</span>'}
                            </div>
                        </div>
                    </article>
                `;
                }).join("")}
            </div>
        </section>
    `).join("");

    shopMenu.addEventListener("click", (event) => {
        const button = event.target.closest(".menu-add-button");
        if (!button) {
            return;
        }

        const item = {
            name: button.dataset.name,
            price: Number(button.dataset.price),
            image: button.dataset.image,
            menuItemId: button.dataset.menuItemId || undefined,
            vendorOwnerId: shop.isPartner ? vendorId.slice("partner-".length) : undefined,
            shopId: shop.isPartner ? undefined : vendorId
        };
        const updated = addItemToCart(item);
        if (updated) updateShopCartBar(updated, item.name);
    });

    cartBar.addEventListener("click", () => {
        window.location.href = "cart.html";
    });

    updateShopCartBar();
}

function initDishPage() {
    const detail = document.querySelector("#dish-detail");
    const title = document.querySelector("#dish-title");
    const backLink = document.querySelector("#dish-back-link");
    const cartBar = document.querySelector("#cart-bar");
    const cartCount = document.querySelector("#cart-count");
    const cartLatest = document.querySelector("#cart-latest");
    const cartTotal = document.querySelector("#cart-total");

    if (!detail || !title) {
        return;
    }

    const params = new URLSearchParams(window.location.search);
    const vendorId = params.get("vendor") || "bibis";
    const dishSlug = params.get("dish") || "";
    const { shop, item } = findDish(vendorId, dishSlug);
    if (!shop || !item) {
        title.textContent = "Meal unavailable";
        detail.innerHTML = '<p class="empty-state visible">This meal is not available right now. Browse other kitchens on the home page.</p>';
        return;
    }
    const details = getDishDetails(item, shop);

    function updateDishCartBar(items = getCart(), latestName = "") {
        const { itemCount, total } = getCartTotals(items);
        cartCount.textContent = `${itemCount} ${itemCount === 1 ? "item" : "items"}`;
        cartLatest.textContent = latestName ? `Added ${latestName}` : "Ready when you are";
        cartTotal.textContent = formatShillings(total);
        cartBar.classList.toggle("visible", itemCount > 0);
    }

    title.textContent = item.name;
    if (backLink) {
        backLink.href = `shop.html?vendor=${encodeURIComponent(vendorId)}`;
    }

    if (shop.isPartner) {
        detail.innerHTML = `
            <img class="dish-photo" src="${escapeHtml(details.photo)}" alt="${escapeHtml(item.name)}">
            <div class="dish-copy">
                <span class="location-kicker">${escapeHtml(shop.name)} - ${escapeHtml(item.category)}</span>
                <h2>${escapeHtml(item.name)}</h2>
                <p>${escapeHtml(item.description)}</p>
                <div class="dish-price-row"><strong>${formatShillings(item.price)}</strong></div>
                <button class="place-order-button" type="button" id="dish-add-button" ${shop.isOpen ? "" : "disabled"}>${shop.isOpen ? "Add to Cart" : "Not accepting orders"}</button>
            </div>
        `;
        detail.querySelector("#dish-add-button").addEventListener("click", () => {
            const updated = addItemToCart({
                name: item.name,
                price: item.price,
                image: details.photo,
                menuItemId: item.menuItemId,
                vendorOwnerId: item.vendorOwnerId
            });
            if (updated) updateDishCartBar(updated, item.name);
        });
        cartBar.addEventListener("click", () => { window.location.href = "cart.html"; });
        updateDishCartBar();
        return;
    }

    detail.innerHTML = `
        <img class="dish-photo" src="${details.photo}" alt="${item.name}">
        <div class="dish-copy">
            <span class="location-kicker">${shop.name} • ${item.category}</span>
            <h2>${item.name}</h2>
            <p>${details.fullDescription}</p>
            <div class="dish-price-row">
                <strong>${formatShillings(item.price)}</strong>
                <span>${details.portion}</span>
            </div>
            <div class="dish-info-grid">
                <section>
                    <h3>Ingredients</h3>
                    <ul>${details.ingredients.map((ingredient) => `<li>${ingredient}</li>`).join("")}</ul>
                </section>
                <section>
                    <h3>Options</h3>
                    <ul>${details.options.map((option) => `<li>${option}</li>`).join("")}</ul>
                </section>
            </div>
            <p class="support-copy">Sample menu for browsing. Ordering opens when an approved kitchen publishes its menu.</p>
        </div>
    `;

    cartBar.addEventListener("click", () => {
        window.location.href = "cart.html";
    });

    updateDishCartBar();
}

function initCartPage() {
    const checkoutItems = document.querySelector("#checkout-items");
    const checkoutEmpty = document.querySelector("#checkout-empty");
    const checkoutCount = document.querySelector("#checkout-count");
    const checkoutSubtotal = document.querySelector("#checkout-subtotal");
    const checkoutDelivery = document.querySelector("#checkout-delivery");
    const checkoutTotal = document.querySelector("#checkout-total");
    const placeOrderButton = document.querySelector("#place-order");
    const cartOrderNotice = document.querySelector("#cart-order-notice");
    const confirmationScreen = document.querySelector("#confirmation-screen");
    const confirmationCopy = document.querySelector("#confirmation-copy");
    const trackOrderLink = document.querySelector("#track-order-link");
    const deliveryAddress = document.querySelector("#delivery-address");
    const deliveryPhone = document.querySelector("#delivery-phone");
    const specialInstructions = document.querySelector("#special-instructions");
    const orderNotes = document.querySelector("#order-notes");
    const useTestAddressButton = document.querySelector("#use-test-address");
    const useSavedAddressButton = document.querySelector("#use-saved-address");
    const paymentOptions = Array.from(document.querySelectorAll(".payment-option"));

    if (!checkoutItems) {
        return;
    }

    function renderCart() {
        const items = getCart();
        const { itemCount, subtotal, total } = getCartTotals(items);

        checkoutItems.innerHTML = "";

        items.forEach((item) => {
            const row = document.createElement("article");
            row.className = "checkout-item";
            const itemKey = escapeHtml(cartItemKey(item));
            row.innerHTML = `
                <img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}">
                <div class="checkout-item-info">
                    <h3>${escapeHtml(item.name)}</h3>
                    <p>${formatShillings(item.price)} each</p>
                    <div class="quantity-controls" aria-label="Quantity controls for ${escapeHtml(item.name)}">
                        <button type="button" data-action="decrease" data-cart-key="${itemKey}">-</button>
                        <span>${Number(item.quantity)}</span>
                        <button type="button" data-action="increase" data-cart-key="${itemKey}">+</button>
                    </div>
                    <button class="remove-cart-item" type="button" data-action="remove" data-cart-key="${itemKey}">Remove</button>
                </div>
                <strong>${formatShillings(item.price * item.quantity)}</strong>
            `;
            checkoutItems.appendChild(row);
        });

        checkoutCount.textContent = `${itemCount} ${itemCount === 1 ? "item" : "items"}`;
        checkoutSubtotal.textContent = formatShillings(subtotal);
        checkoutDelivery.textContent = itemCount > 0 ? formatShillings(deliveryFee) : formatShillings(0);
        checkoutTotal.textContent = formatShillings(total);
        checkoutEmpty.classList.toggle("visible", itemCount === 0);
        const hasSampleItems = items.some((item) => !item.menuItemId || !item.vendorOwnerId);
        if (cartOrderNotice) cartOrderNotice.hidden = !hasSampleItems;
        placeOrderButton.disabled = itemCount === 0 || hasSampleItems;
    }

    checkoutItems.addEventListener("click", (event) => {
        const button = event.target.closest("button");
        if (!button) {
            return;
        }

        if (button.dataset.action === "remove") {
            saveCart(getCart().filter((item) => cartItemKey(item) !== button.dataset.cartKey));
        } else {
            const change = button.dataset.action === "increase" ? 1 : -1;
            updateItemQuantity(button.dataset.cartKey, change);
        }
        renderCart();
    });

    paymentOptions.forEach((option) => {
        option.addEventListener("click", () => {
            paymentOptions.forEach((current) => current.classList.remove("selected"));
            option.classList.add("selected");
        });
    });

    if (useTestAddressButton) {
        useTestAddressButton.addEventListener("click", () => {
            deliveryAddress.value = "House 45, Mumias Road, Lavington Estate — near Lavington Shopping Centre";
            deliveryAddress.classList.remove("field-error");
            deliveryAddress.focus();
        });
    }

    if (useSavedAddressButton) {
        useSavedAddressButton.addEventListener("click", () => {
            const profile = getActiveProfile();
            const savedAddress = profile?.addresses?.[0] || profile?.location || getSelectedLocation();
            const savedPhone = profile?.phone || "";
            deliveryAddress.value = savedAddress;
            if (deliveryPhone && savedPhone) {
                deliveryPhone.value = savedPhone;
            }
            deliveryAddress.classList.remove("field-error");
            deliveryPhone?.classList.remove("field-error");
            deliveryAddress.focus();
        });
    }

    placeOrderButton.addEventListener("click", async () => {
        const items = getCart();
        if (!items.length) {
            return;
        }
        if (items.some((item) => !item.menuItemId || !item.vendorOwnerId)) {
            window.showAppStatus?.("Remove sample meals and choose items from a published partner menu.", true);
            return;
        }
        if (new Set(items.map(cartKitchenKey)).size !== 1) {
            window.showAppStatus?.("Your cart contains meals from different kitchens. Keep one kitchen per order.", true);
            return;
        }

        const trimmedAddress = deliveryAddress.value.trim();
        const trimmedPhone = deliveryPhone?.value.trim() || "";

        if (!hasActiveAccount()) {
            alert("Please create an account or log in before placing an order.");
            window.location.href = "register.html";
            return;
        }

        if (getFirebaseState().user?.emailVerified !== true) {
            alert("Please verify your email address before placing an order.");
            return;
        }

        if (trimmedAddress.length < 10) {
            deliveryAddress.focus();
            deliveryAddress.classList.add("field-error");
            alert("Please enter a clearer delivery address with at least 10 characters.");
            return;
        }

        deliveryAddress.classList.remove("field-error");

        if (trimmedPhone.length < 7) {
            deliveryPhone?.focus();
            deliveryPhone?.classList.add("field-error");
            alert("Please confirm a delivery phone number so the rider can reach you.");
            return;
        }

        deliveryPhone?.classList.remove("field-error");
        const paymentMethod = document.querySelector("input[name='payment-method']:checked").value;
        const { subtotal, total } = getCartTotals(items);
        const now = new Date();
        const order = {
            timestamp: now.toISOString(),
            deliveryAddress: trimmedAddress,
            phone: trimmedPhone,
            deliveryInstructions: specialInstructions?.value.trim() || "",
            notes: orderNotes?.value.trim() || "",
            paymentMethod,
            subtotal,
            deliveryFee,
            items,
            total
        };
        placeOrderButton.disabled = true;
        try {
            order.requestId = await getCheckoutRequestId(order);
            const savedOrder = await getFirebaseBackend().createOrder(order);
            confirmationCopy.textContent = "Order received. Payment is not collected yet; track it in your Order History.";
            confirmationScreen.classList.add("visible");
            if (trackOrderLink) {
                trackOrderLink.href = `order-tracking.html?order=${encodeURIComponent(savedOrder.id)}`;
            }
            saveCart([]);
            clearCheckoutAttempt();
            renderCart();
        } catch (error) {
            window.showAppStatus?.(error.message || "The order could not be placed.", true);
            placeOrderButton.disabled = false;
        }
    });

    renderCart();
}

const imageUploadRules = {
    allowedTypes: ["image/jpeg", "image/png", "image/webp"],
    maxBytes: 2 * 1024 * 1024,
    minWidth: 800,
    minHeight: 600,
    aspectRatios: [
        { label: "1:1", value: 1 },
        { label: "4:3", value: 4 / 3 }
    ]
};

function profileCanAccess(role) {
    const profile = getActiveProfile();
    if (!profile) {
        return false;
    }

    if (role === "customer") {
        return true;
    }

    return userHasRole(profile, role);
}

function renderAccessDenied(roleLabel) {
    const target = document.querySelector("main") || document.body;
    target.innerHTML = `
        <section class="account-layout auth-layout">
            <article class="account-card access-denied-card">
                <h2>Access Denied</h2>
                <p class="support-copy">This page is only available to approved ${roleLabel} accounts.</p>
                <a class="account-row-link" href="account.html">Go to My Account</a>
                <a class="secondary-link" href="index.html">Back to Home</a>
            </article>
        </section>
    `;
}

function getStoredVendorMenu() {
    return getFirebaseState().vendorMenu || [];
}

function getStoredVendorProfile() {
    return getFirebaseState().vendorProfile || {};
}

function getStoredRiderProfile() {
    return getFirebaseState().riderProfile || {};
}

function getImageUploadNote(uploadType = "food") {
    const specific = uploadType === "rider"
        ? "Rider uploads must show the full ID clearly, plus a vehicle photo where the registration plate is readable."
        : "Food uploads must show a clear dish, no clutter, no text, no logos, no watermarks, and no blurry photos.";

    return `${specific} JPG, PNG, or WebP only. Max 2MB. Minimum 800x600px. Use 1:1 or 4:3 only.`;
}

function readImageFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const img = new Image();
            img.onload = () => resolve({ dataUrl: reader.result, width: img.width, height: img.height });
            img.onerror = () => reject(new Error("We could not read this image. Please choose another JPG, PNG, or WebP file."));
            img.src = reader.result;
        };
        reader.onerror = () => reject(new Error("We could not read this file. Please try again."));
        reader.readAsDataURL(file);
    });
}

function aspectRatioIsAllowed(width, height) {
    const ratio = width / height;
    return imageUploadRules.aspectRatios.some((allowed) => Math.abs(ratio - allowed.value) < 0.04);
}

async function validateDashboardImage(input, uploadType, confirmInput, messageElement, previewElement) {
    const file = input.files?.[0];
    if (!file) {
        return null;
    }

    function showUploadError(text) {
        if (messageElement) {
            messageElement.textContent = text;
            messageElement.hidden = false;
            messageElement.classList.add("error");
        }
        input.value = "";
        if (previewElement) {
            previewElement.innerHTML = "";
        }
    }

    if (!imageUploadRules.allowedTypes.includes(file.type)) {
        showUploadError("Please upload a JPG, PNG, or WebP image only.");
        return null;
    }

    if (file.size > imageUploadRules.maxBytes) {
        showUploadError("Image is too large. Please upload an image under 2MB.");
        return null;
    }

    try {
        const image = await readImageFile(file);

        if (image.width < imageUploadRules.minWidth || image.height < imageUploadRules.minHeight) {
            showUploadError("Image resolution is too small. Minimum size is 800x600px.");
            return null;
        }

        if (!aspectRatioIsAllowed(image.width, image.height)) {
            showUploadError("Image must be either square 1:1 or landscape 4:3.");
            return null;
        }

        if (confirmInput && !confirmInput.checked) {
            if (messageElement) {
                messageElement.textContent = uploadType === "rider"
                    ? "Image passed the technical checks. Confirm the ID and registration plate are fully visible to continue."
                    : "Image passed the technical checks. Confirm it has no watermark, logo, text, clutter, or blur to continue.";
                messageElement.hidden = false;
                messageElement.classList.add("error");
            }
            if (previewElement) {
                previewElement.innerHTML = `<img src="${image.dataUrl}" alt="Selected upload preview">`;
            }
            return null;
        }

        if (messageElement) {
            messageElement.textContent = "Image looks good.";
            messageElement.hidden = false;
            messageElement.classList.remove("error");
        }
        if (previewElement) {
            previewElement.innerHTML = `<img src="${image.dataUrl}" alt="Selected upload preview">`;
        }
        return image;
    } catch (error) {
        showUploadError(error.message);
        return null;
    }
}

function imageUploadBlock({ id, label, type = "food" }) {
    return `
        <div class="dashboard-upload" data-upload-block="${id}">
            <p class="upload-rules-note">${getImageUploadNote(type)}</p>
            <label class="field-label" for="${id}">${label}</label>
            <input class="text-field dashboard-file-input" id="${id}" type="file" accept="image/jpeg,image/png,image/webp">
            <label class="checkbox-row upload-confirm-row">
                <input type="checkbox" id="${id}-confirm">
                <span>${type === "rider" ? "I confirm the ID/plate is fully visible and the image is clear." : "I confirm this photo is clear, uncluttered, and has no text, logo, watermark, or blur."}</span>
            </label>
            <p class="auth-message upload-message" id="${id}-message" hidden></p>
            <div class="upload-preview" id="${id}-preview"></div>
        </div>
    `;
}

function setupUploadValidation(root = document) {
    root.querySelectorAll("[data-upload-block]").forEach((block) => {
        const id = block.dataset.uploadBlock;
        const input = block.querySelector(`#${CSS.escape(id)}`);
        const confirm = block.querySelector(`#${CSS.escape(id)}-confirm`);
        const message = block.querySelector(`#${CSS.escape(id)}-message`);
        const preview = block.querySelector(`#${CSS.escape(id)}-preview`);
        const type = id.includes("rider") || id.includes("vehicle") ? "rider" : "food";

        input?.addEventListener("change", () => {
            validateDashboardImage(input, type, confirm, message, preview);
        });
        confirm?.addEventListener("change", () => {
            if (input?.files?.length) {
                validateDashboardImage(input, type, confirm, message, preview);
            }
        });
    });
}

function initCustomerDashboardPhase() {
    const accountLayout = document.querySelector(".account-layout");
    if (!accountLayout || !window.location.pathname.endsWith("account.html") || !profileCanAccess("customer")) {
        return;
    }

    if (document.querySelector(".customer-dashboard-phase")) {
        return;
    }

    const profile = getActiveProfile();
    const panel = document.createElement("article");
    panel.className = "account-card customer-dashboard-phase";
    panel.innerHTML = `
        <div class="account-card-heading">
            <h2>Customer Dashboard</h2>
            <span class="status-badge status-delivered">Active</span>
        </div>
        <div class="role-action-grid">
            <a class="role-action-card" href="index.html"><strong>Browse food</strong><span>Find vendors, dishes, drinks, and offers.</span></a>
            <a class="role-action-card" href="cart.html"><strong>Order checkout</strong><span>Review cart, delivery address, and payment.</span></a>
            <button class="role-action-card" type="button" data-open-location><strong>Change location</strong><span>${getSelectedLocation()}</span></button>
            <a class="role-action-card" href="account.html#profile"><strong>Edit details</strong><span>${profile?.phone || "Update your phone and address"}</span></a>
            <button class="role-action-card danger-action" type="button" data-phase-logout><strong>Log out</strong><span>End this session safely.</span></button>
        </div>
    `;
    accountLayout.prepend(panel);
    panel.querySelector("[data-open-location]")?.addEventListener("click", () => {
        window.location.href = "index.html";
    });
    panel.querySelector("[data-phase-logout]")?.addEventListener("click", async () => {
        try {
            await clearActiveAccount();
            window.location.href = "index.html";
        } catch (error) {
            window.showAppStatus?.(error.message || "Could not sign out.", true);
        }
    });
}

function initVendorDashboardPhase() {
    if (!window.location.pathname.endsWith("vendor-dashboard.html")) {
        return;
    }

    if (!profileCanAccess("vendor")) {
        renderAccessDenied("vendor");
        return;
    }

    const account = getActiveProfile();
    const application = getPartnerApplications()[account.userId]?.cook || {};
    const applicationFields = application.fields || {};
    const vendorProfile = getStoredVendorProfile();
    const target = document.querySelector("main") || document.body;
    target.innerHTML = `
        <section class="dashboard-shell vendor-dashboard">
            <article class="account-card dashboard-hero-panel">
                <div>
                    <span class="location-kicker">Vendor Workspace</span>
                    <h2>${escapeHtml(vendorProfile.kitchenName || applicationFields.businessName || "My Vendor Dashboard")}</h2>
                    <p class="support-copy">Manage the menu customers will see, your order availability, and kitchen details.</p>
                </div>
                <span class="status-badge ${vendorProfile.acceptingOrders === true ? "status-delivered" : "status-cancelled"}" id="vendor-open-status">${vendorProfile.acceptingOrders === true ? "Accepting orders" : "Not accepting orders"}</span>
            </article>
            <article class="account-card">
                <div class="account-card-heading">
                    <div><span class="location-kicker">Sell your food</span><h2>My Menu</h2></div>
                    <span class="status-badge status-pending" id="vendor-menu-count">0 items</span>
                </div>
                <form class="dashboard-form" id="vendor-menu-form">
                    <input name="itemId" type="hidden">
                    ${imageUploadBlock({ id: "vendor-food-upload", label: "Menu item photo", type: "food" })}
                    <label class="field-label">Item name<input class="text-field" name="itemName" required placeholder="Example: Chicken Pilau"></label>
                    <label class="field-label">Short description<textarea class="text-field compact-textarea" name="description" required minlength="10" placeholder="What is included and what makes it special"></textarea></label>
                    <label class="field-label">Price<input class="text-field" name="price" required type="number" min="1" placeholder="450"></label>
                    <label class="field-label">Category<select class="text-field" name="category"><option>Main Meals</option><option>Sides</option><option>Drinks</option><option>Snacks</option></select></label>
                    <label class="settings-row"><span>Available to order</span><input type="checkbox" name="available" checked></label>
                    <div class="dashboard-form-actions">
                        <button class="place-order-button" type="submit" data-menu-submit>Add Menu Item</button>
                        <button class="secondary-link" type="button" data-menu-cancel hidden>Cancel Edit</button>
                    </div>
                    <p class="auth-message" data-menu-message hidden></p>
                </form>
                <div class="dashboard-list" id="vendor-menu-list"></div>
                <p class="application-privacy-note">Menu changes are saved securely and remain linked to your approved vendor account.</p>
            </article>
            <article class="account-card">
                <div class="account-card-heading"><h2>My Orders</h2><span class="status-badge status-preparing">Live queue</span></div>
                <div class="dashboard-list" id="vendor-order-list"></div>
            </article>
            <article class="account-card">
                <h2>Earnings Summary</h2>
                <div class="order-breakdown" id="vendor-earnings-summary"></div>
                <p class="support-copy">Payout processing requires a connected payment provider.</p>
            </article>
            <article class="account-card">
                <h2>Profile Settings</h2>
                <form class="dashboard-form" id="vendor-profile-form">
                    <label class="field-label">Kitchen name<input class="text-field" name="kitchenName" required value="${escapeHtml(vendorProfile.kitchenName || applicationFields.businessName || "Mama Meals Partner Kitchen")}"></label>
                    <label class="field-label">Service area<input class="text-field" name="serviceArea" required value="${escapeHtml(vendorProfile.serviceArea || applicationFields.serviceArea || getSelectedLocation())}"></label>
                    <label class="field-label">About your kitchen<textarea class="text-field compact-textarea" name="about" required>${escapeHtml(vendorProfile.about || applicationFields.experience || "Fresh local meals prepared with care.")}</textarea></label>
                    <label class="settings-row"><span>Accepting orders</span><input type="checkbox" name="acceptingOrders" ${vendorProfile.acceptingOrders === true ? "checked" : ""}></label>
                    <button class="secondary-link" type="submit">Save Kitchen Profile</button>
                    <p class="auth-message" data-vendor-profile-message hidden></p>
                </form>
            </article>
            <article class="account-card dashboard-exit-card">
                <a class="secondary-link" href="account.html">Back to My Account</a>
                <button class="logout-button" type="button" data-phase-logout>Log Out</button>
            </article>
        </section>
    `;

    setupUploadValidation(target);

    const form = document.querySelector("#vendor-menu-form");
    const list = document.querySelector("#vendor-menu-list");
    const orders = document.querySelector("#vendor-order-list");
    const message = form?.querySelector("[data-menu-message]");
    const menuCount = document.querySelector("#vendor-menu-count");
    const menuSubmit = form?.querySelector("[data-menu-submit]");
    const menuCancel = form?.querySelector("[data-menu-cancel]");
    const profileForm = document.querySelector("#vendor-profile-form");

    function renderMenu() {
        const items = getStoredVendorMenu();
        if (menuCount) menuCount.textContent = `${items.length} ${items.length === 1 ? "item" : "items"}`;
        list.innerHTML = items.length ? items.map((item) => `
            <article class="dashboard-list-item">
                <img src="${escapeHtml(item.imageUrl || "images/01_bibis_traditional_meals.png")}" alt="${escapeHtml(item.name)}">
                <div><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.category)} - ${formatShillings(item.price)} - ${item.available === false ? "Unavailable" : "Available"}</span></div>
                <div class="dashboard-item-actions"><button type="button" data-edit-menu="${item.id}">Edit</button><button type="button" data-delete-menu="${item.id}">Delete</button></div>
            </article>
        `).join("") : `<p class="empty-state visible">No menu items yet. Add your first dish above.</p>`;
    }

    function renderOrders() {
        const orderList = getOrders().filter((order) => order.vendorOwnerId === account.userId).slice(0, 8);
        orders.innerHTML = orderList.length ? orderList.map((order) => `
            <article class="dashboard-list-item">
                <div><strong>${escapeHtml(order.id)}</strong><span>${order.items.length} items - ${formatShillings(order.total)} - ${escapeHtml(order.status)}</span></div>
                ${String(order.status).includes("Order Received")
                    ? `<button class="small-action-button" type="button" data-vendor-order-action="preparing" data-order-id="${escapeHtml(order.id)}">Start Preparing</button>`
                    : `<a class="text-action" href="order-tracking.html?order=${encodeURIComponent(order.id)}">View</a>`}
            </article>
        `).join("") : `<p class="empty-state visible">No orders are assigned to this kitchen yet. Customer-to-vendor assignment starts when the live menu backend is connected.</p>`;

        const delivered = orderList.filter((order) => String(order.status).includes("Delivered"));
        const gross = delivered.reduce((total, order) => total + Number(order.subtotal || order.total || 0), 0);
        const earnings = document.querySelector("#vendor-earnings-summary");
        if (earnings) earnings.innerHTML = `
            <div><span>Completed orders</span><strong>${delivered.length}</strong></div>
            <div><span>Gross sales</span><strong>${formatShillings(gross)}</strong></div>
            <div><span>Pending payout</span><strong>${formatShillings(0)}</strong></div>
        `;
    }

    function resetMenuForm() {
        form.reset();
        form.elements.itemId.value = "";
        form.elements.available.checked = true;
        document.querySelector("#vendor-food-upload-preview").innerHTML = "";
        document.querySelector("#vendor-food-upload-message").hidden = true;
        if (menuSubmit) menuSubmit.textContent = "Add Menu Item";
        if (menuCancel) menuCancel.hidden = true;
    }

    form?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const editingId = form.elements.itemId.value;
        const currentItems = getStoredVendorMenu();
        const existingItem = currentItems.find((item) => item.id === editingId);
        const upload = document.querySelector("#vendor-food-upload");
        const confirm = document.querySelector("#vendor-food-upload-confirm");
        const uploadMessage = document.querySelector("#vendor-food-upload-message");
        const preview = document.querySelector("#vendor-food-upload-preview");
        const image = upload.files?.length ? await validateDashboardImage(upload, "food", confirm, uploadMessage, preview) : null;
        if (!image && !existingItem?.imagePath) {
            if (uploadMessage) {
                uploadMessage.textContent = "Add a clear menu photo before saving this item.";
                uploadMessage.hidden = false;
                uploadMessage.classList.add("error");
            }
            return;
        }

        const item = {
            id: editingId || undefined,
            name: form.elements.itemName.value.trim(),
            description: form.elements.description.value.trim(),
            price: Number(form.elements.price.value),
            category: form.elements.category.value,
            available: form.elements.available.checked,
            imagePath: existingItem?.imagePath || "",
            imageUrl: existingItem?.imageUrl || "",
            updatedAt: new Date().toISOString()
        };
        try {
            await getFirebaseBackend().saveMenuItem(item, upload.files?.[0] || null);
        } catch (error) {
            if (message) {
                message.textContent = error.message || "The menu item could not be saved.";
                message.hidden = false;
                message.classList.add("error");
            }
            return;
        }
        resetMenuForm();
        if (message) {
            message.textContent = existingItem ? "Menu item updated." : "Menu item added.";
            message.hidden = false;
            message.classList.remove("error");
        }
        renderMenu();
    });

    list?.addEventListener("click", async (event) => {
        const deleteButton = event.target.closest("[data-delete-menu]");
        const editButton = event.target.closest("[data-edit-menu]");
        if (deleteButton) {
            try {
                await getFirebaseBackend().deleteMenuItem(deleteButton.dataset.deleteMenu);
                renderMenu();
                window.showAppStatus?.("Menu item removed.");
            } catch (error) {
                window.showAppStatus?.(error.message || "Menu item could not be removed.", true);
            }
        }
        if (editButton) {
            const item = getStoredVendorMenu().find((menuItem) => menuItem.id === editButton.dataset.editMenu);
            if (!item) return;
            form.elements.itemId.value = item.id;
            form.elements.itemName.value = item.name;
            form.elements.description.value = item.description || "";
            form.elements.price.value = item.price;
            form.elements.category.value = item.category;
            form.elements.available.checked = item.available !== false;
            document.querySelector("#vendor-food-upload-preview").innerHTML = item.imageUrl
                ? `<img src="${escapeHtml(item.imageUrl)}" alt="Current ${escapeHtml(item.name)} photo">`
                : "";
            if (menuSubmit) menuSubmit.textContent = "Save Menu Item";
            if (menuCancel) menuCancel.hidden = false;
            form.scrollIntoView({ behavior: "smooth", block: "start" });
        }
    });

    menuCancel?.addEventListener("click", resetMenuForm);

    orders?.addEventListener("click", async (event) => {
        const actionButton = event.target.closest("[data-vendor-order-action]");
        if (!actionButton) return;
        actionButton.disabled = true;
        try {
            await getFirebaseBackend().updateOrderStatus(actionButton.dataset.orderId, actionButton.dataset.vendorOrderAction);
            renderOrders();
            window.showAppStatus?.("Order marked as preparing.");
        } catch (error) {
            window.showAppStatus?.(error.message || "The order could not be updated.", true);
            actionButton.disabled = false;
        }
    });

    profileForm?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const nextProfile = {
            kitchenName: profileForm.elements.kitchenName.value.trim(),
            serviceArea: profileForm.elements.serviceArea.value.trim(),
            about: profileForm.elements.about.value.trim(),
            acceptingOrders: profileForm.elements.acceptingOrders.checked,
            updatedAt: new Date().toISOString()
        };
        const profileMessage = profileForm.querySelector("[data-vendor-profile-message]");
        try {
            await getFirebaseBackend().saveVendorProfile(nextProfile);
            const status = document.querySelector("#vendor-open-status");
            if (status) {
                status.textContent = nextProfile.acceptingOrders ? "Accepting orders" : "Not accepting orders";
                status.className = `status-badge ${nextProfile.acceptingOrders ? "status-delivered" : "status-cancelled"}`;
            }
            if (profileMessage) {
                profileMessage.textContent = "Kitchen profile saved.";
                profileMessage.hidden = false;
                profileMessage.classList.remove("error");
            }
            window.showAppStatus?.("Kitchen profile saved.");
        } catch (error) {
            if (profileMessage) {
                profileMessage.textContent = error.message || "Kitchen profile could not be saved.";
                profileMessage.hidden = false;
                profileMessage.classList.add("error");
            }
        }
    });

    target.querySelector("[data-phase-logout]")?.addEventListener("click", async () => {
        try {
            await clearActiveAccount();
            window.location.href = "index.html";
        } catch (error) {
            window.showAppStatus?.(error.message || "Could not sign out.", true);
        }
    });

    renderMenu();
    renderOrders();
}

function initRiderDashboardPhase() {
    if (!window.location.pathname.endsWith("rider-dashboard.html")) {
        return;
    }

    if (!profileCanAccess("rider")) {
        renderAccessDenied("rider");
        return;
    }

    const account = getActiveProfile();
    const rider = getStoredRiderProfile();
    const application = getPartnerApplications()[account.userId]?.rider || {};
    const applicationFields = application.fields || {};
    const target = document.querySelector("main") || document.body;
    target.innerHTML = `
        <section class="dashboard-shell rider-dashboard">
            <article class="account-card dashboard-hero-panel">
                <div>
                    <span class="location-kicker">Rider Workspace</span>
                    <h2>Welcome, ${escapeHtml(getFirstName(account))}</h2>
                    <p class="support-copy">Set your availability, accept a nearby delivery, and keep each trip moving.</p>
                </div>
                <span class="status-badge ${rider.available ? "status-delivered" : "status-cancelled"}" id="rider-availability-status">${rider.available ? "Available" : "Unavailable"}</span>
            </article>
            <article class="account-card">
                <div class="account-card-heading"><h2>Rider Details</h2><span class="status-badge status-delivered">Approved</span></div>
                <form class="dashboard-form" id="rider-profile-form">
                    <label class="field-label">Service area<input class="text-field" name="serviceArea" required value="${escapeHtml(rider.serviceArea || applicationFields.location || getSelectedLocation())}"></label>
                    <label class="field-label">Vehicle type<select class="text-field" name="vehicleType" required><option ${((rider.vehicleType || applicationFields.vehicleType) === "Bicycle") ? "selected" : ""}>Bicycle</option><option ${((rider.vehicleType || applicationFields.vehicleType) === "Motorbike") ? "selected" : ""}>Motorbike</option><option ${((rider.vehicleType || applicationFields.vehicleType) === "Car") ? "selected" : ""}>Car</option><option ${((rider.vehicleType || applicationFields.vehicleType) === "Walking delivery") ? "selected" : ""}>Walking delivery</option></select></label>
                    <label class="field-label">Registration plate<input class="text-field" name="plate" required value="${escapeHtml(rider.plate || applicationFields.registrationPlate || "")}" placeholder="Example: KDA 123A or N/A"></label>
                    <label class="settings-row"><span>Available for deliveries</span><input type="checkbox" name="available" ${rider.available ? "checked" : ""}></label>
                    <button class="place-order-button" type="submit">Save Rider Details</button>
                    <p class="auth-message" data-rider-message hidden></p>
                </form>
                <div class="verification-summary">
                    <strong>Verification reference</strong>
                    <span>${escapeHtml(application.reference || "Approved role record")}</span>
                    <small>${(application.documents || []).length} verified files are stored in protected Firebase Storage.</small>
                </div>
            </article>
            <article class="account-card">
                <div class="account-card-heading"><h2>Available Deliveries</h2><span class="status-badge status-delivery" id="available-delivery-count">0 nearby</span></div>
                <div class="dashboard-list" id="rider-delivery-list"></div>
            </article>
            <article class="account-card">
                <h2>My Active Trips</h2>
                <div class="dashboard-list" id="rider-active-list"></div>
            </article>
            <article class="account-card">
                <h2>Delivery History</h2>
                <div class="dashboard-list" id="rider-history-list"></div>
            </article>
            <article class="account-card">
                <h2>Earnings</h2>
                <div class="order-breakdown" id="rider-earnings-summary"></div>
                <p class="support-copy">Real payouts require a connected payment provider.</p>
            </article>
            <article class="account-card dashboard-exit-card">
                <a class="secondary-link" href="account.html">Back to My Account</a>
                <button class="logout-button" type="button" data-phase-logout>Log Out</button>
            </article>
        </section>
    `;

    const form = document.querySelector("#rider-profile-form");
    const deliveries = document.querySelector("#rider-delivery-list");
    const activeList = document.querySelector("#rider-active-list");
    const historyList = document.querySelector("#rider-history-list");

    function renderRiderWork() {
        const orders = getOrders();
        const available = getFirebaseState().deliveryOffers || [];
        const active = orders.filter((order) => (
            order.assignedRiderId === account.userId &&
            !String(order.status).includes("Delivered") &&
            !String(order.status).includes("Cancelled")
        ));
        const completed = orders.filter((order) => (
            order.assignedRiderId === account.userId && String(order.status).includes("Delivered")
        ));
        const count = document.querySelector("#available-delivery-count");
        if (count) count.textContent = `${available.length} nearby`;

        deliveries.innerHTML = rider.available && available.length ? available.slice(0, 8).map((order) => `
            <article class="dashboard-list-item rider-delivery-item">
                <div><strong>${escapeHtml(order.id)}</strong><span>Address shared after acceptance - Fee ${formatShillings(order.deliveryFee || deliveryFee)}</span></div>
                <button class="small-action-button" type="button" data-rider-order-action="accept" data-order-id="${escapeHtml(order.id)}">Accept</button>
            </article>
        `).join("") : `<p class="empty-state visible">${rider.available ? "No deliveries are waiting right now." : "Set yourself as available to see nearby deliveries."}</p>`;

        activeList.innerHTML = active.length ? active.map((order) => {
            const outForDelivery = String(order.status).includes("Out for Delivery");
            return `
                <article class="dashboard-list-item rider-delivery-item">
                    <div><strong>${escapeHtml(order.id)}</strong><span>${escapeHtml(order.deliveryAddress || "Address pending")} - ${escapeHtml(order.status)}</span></div>
                    <div class="dashboard-item-actions">
                        ${outForDelivery ? "" : `<button type="button" data-rider-order-action="start" data-order-id="${escapeHtml(order.id)}">Start Delivery</button>`}
                        ${outForDelivery ? `<button type="button" data-rider-order-action="complete" data-order-id="${escapeHtml(order.id)}">Delivered</button>` : ""}
                    </div>
                </article>
            `;
        }).join("") : '<p class="empty-state visible">No active trips.</p>';

        historyList.innerHTML = completed.length ? completed.slice(0, 8).map((order) => `
            <article class="dashboard-list-item">
                <div><strong>${escapeHtml(order.id)}</strong><span>${escapeHtml(order.deliveryAddress || "Address unavailable")}</span></div>
                <strong>${formatShillings(order.deliveryFee || deliveryFee)}</strong>
            </article>
        `).join("") : '<p class="empty-state visible">No completed deliveries yet.</p>';

        const earnings = completed.reduce((total, order) => total + Number(order.deliveryFee || deliveryFee), 0);
        document.querySelector("#rider-earnings-summary").innerHTML = `
            <div><span>Completed trips</span><strong>${completed.length}</strong></div>
            <div><span>Recorded earnings</span><strong>${formatShillings(earnings)}</strong></div>
            <div><span>Pending payout</span><strong>${formatShillings(earnings)}</strong></div>
        `;
    }

    form?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const nextProfile = {
            plate: form.elements.plate.value.trim(),
            vehicleType: form.elements.vehicleType.value,
            serviceArea: form.elements.serviceArea.value.trim(),
            available: form.elements.available.checked,
            updatedAt: new Date().toISOString()
        };
        const message = form.querySelector("[data-rider-message]");
        try {
            await getFirebaseBackend().saveRiderProfile(nextProfile);
            if (message) {
                message.textContent = "Rider details saved.";
                message.hidden = false;
                message.classList.remove("error");
            }
            const status = document.querySelector("#rider-availability-status");
            if (status) {
                status.textContent = nextProfile.available ? "Available" : "Unavailable";
                status.className = `status-badge ${nextProfile.available ? "status-delivered" : "status-cancelled"}`;
            }
            rider.available = nextProfile.available;
            renderRiderWork();
            window.showAppStatus?.("Rider details saved.");
        } catch (error) {
            if (message) {
                message.textContent = error.message || "Rider details could not be saved.";
                message.hidden = false;
                message.classList.add("error");
            }
        }
    });

    target.addEventListener("click", async (event) => {
        const actionButton = event.target.closest("[data-rider-order-action]");
        if (!actionButton) return;
        const orderId = actionButton.dataset.orderId;
        const action = actionButton.dataset.riderOrderAction;
        if (action === "accept") {
            if (!rider.available) {
                window.showAppStatus?.("Set yourself as available before accepting a delivery.", true);
                return;
            }
        }
        try {
            await getFirebaseBackend().updateOrderStatus(orderId, action === "complete" ? "delivered" : action);
            renderRiderWork();
            window.showAppStatus?.(action === "accept" ? "Delivery accepted." : action === "start" ? "Trip marked out for delivery." : "Delivery completed.");
        } catch (error) {
            window.showAppStatus?.(error.message || "The delivery could not be updated.", true);
        }
    });

    target.querySelector("[data-phase-logout]")?.addEventListener("click", async () => {
        try {
            await clearActiveAccount();
            window.location.href = "index.html";
        } catch (error) {
            window.showAppStatus?.(error.message || "Could not sign out.", true);
        }
    });

    renderRiderWork();
}

function initRoleDashboardPhase() {
    initCustomerDashboardPhase();
    initVendorDashboardPhase();
    initRiderDashboardPhase();
}

function initAccessibilityBasics() {
    const main = document.querySelector("main");
    if (!main) return;

    if (!main.id) main.id = "main-content";
    if (!document.querySelector(".skip-link")) {
        const skipLink = document.createElement("a");
        skipLink.className = "skip-link";
        skipLink.href = `#${main.id}`;
        skipLink.textContent = "Skip to main content";
        document.body.prepend(skipLink);
    }
}

initAccessibilityBasics();
initGlobalFeedback();

async function initializeMamaMeals() {
    const backend = getFirebaseBackend();
    if (backend) await backend.ready;

    if (backend?.state.configured && document.querySelector("#vendor-list, #shop-hero, #dish-detail")) {
        try {
            await backend.loadMarketplace();
            renderMarketplaceVendors();
        } catch (error) {
            window.showAppStatus?.("Partner kitchens could not load. Please refresh to try again.", true);
        }
    }

    initAccountPrototype();
    initAuthHeader();
    initPersistentAuthNavigation();
    initNotificationButtons();
    initHomePage();
    initShopPage();
    initDishPage();
    initCartPage();
    initAccountPage();
    initAdminDashboard();
    initApplicationForms();
    initApplicationConfirmation();
    initGlobalPrototypeActions();
    initOrderHistoryPage();
    initOrderTrackingPage();
    initRoleDashboardPhase();
}

initializeMamaMeals().catch((error) => {
    window.showAppStatus?.(error.message || "Mama Meals could not start securely.", true);
});

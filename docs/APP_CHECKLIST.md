# Mama Meals app checklist

Last updated: 6 November 2026. Tick an item when it passes in the environment named. A checked box does **not** mean a change is live.

**Next action:** Review the mobile homepage at phone width before redesigning another screen. The latest source checkpoint includes the meal list; live publication remains on hold.

## Where each version stands

| Version | What it contains |
| --- | --- |
| Source checkpoint | All five fixes below, plus the mobile homepage change and this checklist. |
| Git history | Three order and dashboard fixes in `0ddb768`; two checkout fixes in `13c51da`; the following checkpoint includes the mobile homepage and checklist. GitHub source updates do not mean the website is published. |
| [Test 4 preview](https://6aeca349018bb74198b7cb00--mamamealstest4.netlify.app) | The first three fixes only. Use local previews for checkout and the new homepage. |
| [Main site](https://mamamealstest4.netlify.app) | The older published version. Publishing is intentionally on hold. |

## Accomplished

- [x] **Static HTML deployment:** Prepared and previewed the site with `index.html` at the publish root, without running Hugo. Verified the preview's scripts, styles and Firebase configuration against the prepared files.
- [x] **Admin and partner access:** Saw the admin dashboard, approved cook and rider applications, and the corresponding vendor and rider dashboards. This confirmed access for the test accounts, not isolation between roles.
- [x] **Customer-to-delivery test:** A controlled cash-on-delivery order went from customer checkout to vendor preparation, rider acceptance, delivery, and customer order history. The KSh 530 total matched KSh 500 for food plus KSh 30 delivery. Vendor sales and rider earnings updated as records, not payouts.
- [x] **Fix 1 - Vendor:** Order details expand in the vendor dashboard instead of sending the vendor to customer tracking. Confirmed in the preview.
- [x] **Fix 2 - Rider:** Addresses wrap normally and trip buttons have their own space. Checked at multiple widths locally and confirmed the dashboard layout in the preview.
- [x] **Fix 3 - Customer tracking:** The kitchen name comes from the order's vendor, not a guess based on the dish. Confirmed in the preview.
- [x] **Fix 4 - Checkout:** Selecting cash hides the M-Pesa notice. Switching back restores it. Verified locally.
- [x] **Fix 5 - Checkout:** The M-Pesa option explains that no payment request will be sent. Verified locally on mobile; no payment integration was added.
- [x] **Homepage first pass:** Replaced the phone's sideways meal carousel with a list and aligned prices. Verified search, clear, photos, and dish links locally. Desktop layout, colours and photos were retained.
- [x] **Automated checks:** The three dashboard/tracking fixes passed their regression tests; the Firebase security suite passed 116 tests in the emulator. These checks do not replace testing with separate signed-in accounts.

## Next small steps

- [ ] **Review the mobile homepage.** Compare the before/after phone previews. Approve the meal list or note one adjustment before further UI work.
- [ ] **Choose the next screen for UI work.** Suggested: the vendor shop page. Check whether a customer can see the dish, price, and Add to Cart control without horizontal scrolling.
- [ ] **Check updates together on a fresh preview** when ready. Test homepage search, one dish link, and both checkout payment choices; do not repeat a full order just to verify wording.

## Before real customers use it

- [ ] **Verify role boundaries with separate accounts.** Test customer-only, vendor-only, rider-only and admin sessions after sign-in settles. Try direct dashboard links as well as menus. Verify a vendor cannot see another vendor's orders and a rider cannot see another rider's private trip details.
- [ ] **Decide the launch payment methods.** If cash-only, remove or disable M-Pesa for launch. If offering M-Pesa, connect and test successful, failed and cancelled payments before advertising it as available.
- [ ] **Decide how vendors and riders are paid.** Recorded earnings are not payouts. Verify the agreed payout and reconciliation process.
- [ ] **Review customer-facing placeholders and test content.** Decide whether to finish or hide the live map and review features. Check kitchen descriptions, menu photos and sample listings before launch.
- [ ] **Run one final controlled order on the release candidate** with separate accounts. Confirm the same order and amounts appear for the customer, vendor, rider and admin as appropriate.
- [ ] **Release only when approved.** Push the reviewed commits, verify the intended build on Netlify, then publish and check the main URL. Do not unlock automatic publishing as part of routine UI work. See the [production runbook](PRODUCTION_RUNBOOK.md) for operational checks and rollback.

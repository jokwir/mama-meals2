# Authentication And Roles Plan

This is a planning document. Firebase Authentication itself is configured in the Firebase Console or with infrastructure scripts later.

## Providers

- Phone number authentication for customer OTP login.
- Email/password for admin, vendor, and rider management.
- Optional Google sign-in for customers later.

## User Roles

Store the user role in `users/{uid}.role`.

- `customer`: can manage their account and create/read their own orders.
- `vendor`: approved cook/vendor account, can manage their vendor profile and menu items.
- `rider`: approved delivery rider, can view assigned deliveries and update delivery status.
- `admin`: can approve applications, manage users, view orders, and edit platform settings.

## Approval Flow

1. User submits `vendorApplications` or `riderApplications`.
2. Admin reviews the application.
3. Admin updates application status to `approved`.
4. Backend/Cloud Function creates or updates the matching `vendors` or `riders` document.
5. Backend/Cloud Function updates `users/{uid}.role`.

## Future Cloud Functions

- Send verification email after application submission.
- Approve/reject vendor applications.
- Approve/reject rider applications.
- Create order records with server timestamp.
- Send order status notifications.

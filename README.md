# 🎓 Test CampusClutch

To confirm you have the latest build, open **Privacy Policy** from sign-in or Profile. It should say **Updated November 23, 2026**.

**🚀 First run on Windows** — Open PowerShell or Command Prompt in the folder where you want the clone. Paste both lines together.

```bat
git clone -c http.sslBackend=schannel --depth 1 --single-branch --branch codex/friend-preview https://github.com/Marchosias405/CampusClutch.git CampusClutch-test
.\CampusClutch-test\Run-on-Windows.cmd
```

- 💻 Use an Intel or AMD 64-bit Windows PC with [Git for Windows](https://git-scm.com/downloads/win) installed and [hardware virtualization enabled](https://developer.android.com/studio/run/emulator-acceleration).
- 📱 Leave the terminal open. The launcher starts a virtual phone, installs the app and opens CampusClutch. On first setup, allow several GB for Android downloads and review the license prompts. If asked, choose your virtual phone by number.
- 👋 Sign in with your Preview tester account, or create one with an email you can verify.
- 🧪 Try adding a course, reading its reviews, and posting a test request. With a second tester, send a direct message and check that the recipient sees it.
- 💬 Send Kazi the screen name, what you tapped, what you expected and what happened. A screenshot helps!

**🔄 Already cloned?** Open either terminal **inside the cloned folder** and paste both lines to update and launch. To just reopen the app, paste the last line.

```bat
git -c http.sslBackend=schannel pull --ff-only
.\Run-on-Windows.cmd
```

**🍎 Mac or Linux** — Start a virtual phone in Android Studio, drag `CampusClutch-Preview.apk` onto it and open CampusClutch from the apps list. [Android emulator guide](https://developer.android.com/studio/run/emulator-install-add-files)

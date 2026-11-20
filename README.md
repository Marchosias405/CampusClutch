# 🎓 Test CampusClutch

**🚀 First run on Windows** — Open PowerShell or Command Prompt in the folder where you want the clone. Paste both lines together.

```bat
git clone -c http.sslBackend=schannel --depth 1 --single-branch --branch codex/friend-preview https://github.com/Marchosias405/CampusClutch.git CampusClutch-test
.\CampusClutch-test\Run-on-Windows.cmd
```

- 💻 Use an Intel or AMD 64-bit Windows PC with [Git for Windows](https://git-scm.com/downloads/win) installed and [hardware virtualization enabled](https://developer.android.com/studio/run/emulator-acceleration).
- 📱 Leave the terminal open. The launcher starts a virtual phone, installs the app and opens CampusClutch. On first setup, allow several GB for Android downloads and review the license prompts. If asked, choose your virtual phone by number.
- 👋 Sign in with your Preview tester account. Ask Kazi for one if you need it.
- 💬 Send Kazi the screen name, what you tapped, what you expected and what happened. A screenshot helps!

**🔄 Already cloned?** Open either terminal **inside the cloned folder** and paste both lines to update and launch. To just reopen the app, paste the last line.

```bat
git pull --ff-only
.\Run-on-Windows.cmd
```

**🍎 Mac or Linux** — Start a virtual phone in Android Studio, drag `CampusClutch-Preview.apk` onto it and open CampusClutch from the apps list. [Android emulator guide](https://developer.android.com/studio/run/emulator-install-add-files)

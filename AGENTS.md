# FlipThis repository and deployment

- The user's repository and publishing target is **https://github.com/akumar326/FlipThis**.
- Vercel's `flipthis` project is connected to that fork's **main** branch. Production is **https://flipthis.vercel.app**. A push to main can deploy the live site.
- `JeremyChen212/FlipThis` is the original upstream. Do not push to it; the user explicitly switched future work to their own fork.
- Before publishing, verify the checkout's `origin` points to `akumar326/FlipThis`. This working directory may not itself be a Git checkout; preserve its files when preparing a publishing checkout.
- Preserve local practice and the classic demo. Test relevant changes before publishing; use the existing unit/API, typecheck, build, and browser checks as appropriate.
- Keep `.env.local`, service-account files, host/player tokens, and Vercel credentials out of commits and logs. Use free service tiers; do not enable billing.

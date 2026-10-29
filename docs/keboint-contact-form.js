/*
 * keboint.com: make the "Request a Quote" form really send the RFQ.
 *
 * In keboint.com/script.js the form only PRETENDS to send: after 1.8 seconds it
 * shows "Inquiry Submitted Successfully!" and the inquiry goes nowhere.
 *
 * Replace the block that starts with   // Simulate form submission
 *                         and ends with   }, 1800);
 * (inside contactForm.addEventListener('submit', …)) with the code below.
 * The validation and the "Sending Request..." spinner above it stay as they are.
 *
 * "Not a robot" check (Cloudflare Turnstile, free):
 *   1. dash.cloudflare.com → Turnstile → Add widget, domain keboint.com, mode "Managed".
 *      It gives a SITE KEY (public) and a SECRET KEY (private).
 *   2. On keboint.com, inside the <form id="contactForm"> just above the submit button, add:
 *        <div class="cf-turnstile" data-sitekey="YOUR-SITE-KEY"></div>
 *      and once in the page <head>:
 *        <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
 *   3. Upload the website, check a test inquiry arrives, THEN put the secret key on the server:
 *        TURNSTILE_SECRET_KEY=... in /opt/kebo-rfq/.env, then: docker compose up -d
 *      (Doing step 3 before the website has the widget would refuse every website inquiry.)
 *
 * The form key: copy it from RFQ Desk, Settings → Website form, into FORM_KEY below. It says
 * which company the inquiry is for. (Without it, keboint.com is still accepted for Kebo,
 * because it is in PUBLIC_FORM_ORIGINS on the server; with it, that list is not needed.)
 */

            const FORM_KEY = 'PASTE-THE-KEY-FROM-SETTINGS';

            const select = document.getElementById('form-service');
            const category = select.options[select.selectedIndex].text.trim(); // e.g. "Medical Devices & Equipment"

            fetch('https://rfq.fawadiqbal.dev/api/public/inquiries', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-Form-Key': FORM_KEY },
                body: JSON.stringify({
                    fullName: name,
                    email: email,
                    phone: phone,
                    company: company,
                    category: category,
                    requirements: message || ('Sourcing request: ' + category),
                    page: window.location.href,
                    // Token from the Turnstile widget (empty until it is added to the page).
                    turnstileToken: (contactForm.querySelector('[name="cf-turnstile-response"]') || {}).value || '',
                }),
            })
                .then(function (res) {
                    return res.json().catch(function () { return {}; }).then(function (data) {
                        if (!res.ok || !data.ok) throw new Error(data.message || 'Sorry, the inquiry could not be sent.');
                        return data;
                    });
                })
                .then(function () {
                    const formCard = contactForm.parentElement;
                    formCard.innerHTML = `
                        <div class="form-success-wrapper text-center" style="padding: 40px 20px; animation: fadeIn 0.5s ease-out;">
                            <div class="success-icon-wrapper" style="width: 80px; height: 80px; background-color: var(--light-blue); color: var(--primary-blue); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 24px auto;">
                                <svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
                            </div>
                            <h3 style="font-size: 24px; margin-bottom: 12px; color: var(--primary-blue);">Inquiry Submitted Successfully!</h3>
                            <p style="color: var(--grey-text); margin-bottom: 24px; font-size: 15px;">Our technical engineering team will review your requirements and reach out to you within 24 hours.</p>
                            <button class="btn btn-primary" onclick="window.location.reload();">Submit Another Inquiry</button>
                        </div>`;
                })
                .catch(function (err) {
                    if (window.turnstile) window.turnstile.reset(); // a token works once
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = originalText;
                    alert(err.message + '\n\nYou can also reach us on WhatsApp or email.');
                });

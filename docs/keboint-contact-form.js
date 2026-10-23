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
 */

            const select = document.getElementById('form-service');
            const category = select.options[select.selectedIndex].text.trim(); // e.g. "Medical Devices & Equipment"

            fetch('https://rfq.fawadiqbal.dev/api/public/inquiries', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({
                    fullName: name,
                    email: email,
                    phone: phone,
                    company: company,
                    category: category,
                    requirements: message || ('Sourcing request: ' + category),
                    page: window.location.href,
                }),
            })
                .then(function (res) {
                    return res.json().catch(function () { return {}; }).then(function (data) {
                        if (!res.ok || !data.ok) throw new Error(data.message || 'Sorry, the inquiry could not be sent.');
                        return data;
                    });
                })
                .then(function (data) {
                    const formCard = contactForm.parentElement;
                    formCard.innerHTML = `
                        <div class="form-success-wrapper text-center" style="padding: 40px 20px; animation: fadeIn 0.5s ease-out;">
                            <div class="success-icon-wrapper" style="width: 80px; height: 80px; background-color: var(--light-blue); color: var(--primary-blue); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 24px auto;">
                                <svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
                            </div>
                            <h3 style="font-size: 24px; margin-bottom: 12px; color: var(--primary-blue);">Inquiry Submitted Successfully!</h3>
                            <p style="color: var(--grey-text); margin-bottom: 8px; font-size: 15px;">Your reference number is <strong>${data.reference}</strong>.</p>
                            <p style="color: var(--grey-text); margin-bottom: 24px; font-size: 15px;">Our technical engineering team will review your requirements and reach out to you within 24 hours.</p>
                            <button class="btn btn-primary" onclick="window.location.reload();">Submit Another Inquiry</button>
                        </div>`;
                })
                .catch(function (err) {
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = originalText;
                    alert(err.message + '\n\nYou can also reach us on WhatsApp or email.');
                });

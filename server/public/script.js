// Rooka Website Interactive Script
document.addEventListener('DOMContentLoaded', () => {
  // 0. Daytime (Light) vs Nighttime (Dark) Theme Controller
  const themeToggleBtn = document.getElementById('theme-toggle');

  function getActiveTheme() {
    const docTheme = document.documentElement.getAttribute('data-theme');
    if (docTheme === 'light' || docTheme === 'dark') return docTheme;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function setPageTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('rooka-theme', theme);
    } catch (e) {}

    if (themeToggleBtn) {
      const isDark = theme === 'dark';
      themeToggleBtn.setAttribute('aria-label', isDark ? 'Switch to Daytime mode (Turquoise)' : 'Switch to Nighttime mode (Ultramarine)');
      themeToggleBtn.setAttribute('title', isDark ? 'Switch to Daytime (Turquoise #0EA5E9)' : 'Switch to Nighttime (Ultramarine #3B82F6)');
      const labelText = themeToggleBtn.querySelector('.theme-label-text');
      if (labelText) {
        labelText.textContent = isDark ? 'Night' : 'Day';
      }
    }
  }

  // Initialize UI state based on active theme
  setPageTheme(getActiveTheme());

  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const current = getActiveTheme();
      const nextTheme = current === 'dark' ? 'light' : 'dark';
      setPageTheme(nextTheme);
    });
  }

  // Listen for system theme change if no manual selection stored
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      try {
        if (!localStorage.getItem('rooka-theme')) {
          setPageTheme(e.matches ? 'dark' : 'light');
        }
      } catch (err) {}
    });
  }

  // 1. FAQ Accordion Toggle
  const faqItems = document.querySelectorAll('.faq-item');
  faqItems.forEach(item => {
    const questionBtn = item.querySelector('.faq-question');
    if (questionBtn) {
      questionBtn.addEventListener('click', () => {
        const isOpen = item.classList.contains('open');
        // Close other open items
        faqItems.forEach(other => other.classList.remove('open'));
        if (!isOpen) {
          item.classList.add('open');
        }
      });
    }
  });

  // 2. Interactive AI Coach Simulator Tabs (Multimodal Vision, HRV, Watch Push, Hyrox, Taper)
  const simTabBtns = document.querySelectorAll('.sim-tab-btn');
  const userQueryEl = document.getElementById('sim-user-query');
  const coachResponseEl = document.getElementById('sim-coach-response');
  const simAvatarImg = document.getElementById('sim-avatar-img');
  const simCoachName = document.getElementById('sim-coach-name');

  const coachSimData = {
    food: {
      question: "[Photo: Sourdough toast, 2 eggs, avocado, and flat white] Just had breakfast before my 2-hour threshold bike ride. Are my macros on target?",
      response: "Scanned your plate: ~520 kcal (48g Carbohydrates, 22g Protein, 26g Healthy Fats). For your 2-hour threshold ride today, your glycogen burn rate will average ~65g carbs/hour. Your breakfast provides a solid baseline, but fats slow gastric emptying—so start sipping high-glycemic carbs (e.g. 60g maltodextrin/fructose mix in your bottle) 25 minutes into the ride to keep power above 240W without GI distress.",
      avatar: "images/avatars/empathetic-default.png",
      coachName: "Coach Rooka (Empathetic Tone)"
    },
    recovery: {
      question: "My legs feel heavy and my HRV dropped 15ms. Should I still do my 5x1km threshold intervals today?",
      response: "Based on your 15ms HRV drop and yesterday's 90-min tempo run, your recovery readiness is at 62 (Caution). Pushing threshold intervals today will increase fatigue without proportional adaptation. Let's pivot: swap today to a 45-min Zone 1 flush run (Heart Rate < 135 bpm) or 30-min easy spin, and push your 5x1km threshold session to tomorrow.",
      avatar: "images/avatars/empathetic-default.png",
      coachName: "Coach Rooka (Empathetic Tone)"
    },
    watch: {
      question: "Can I push today's 4x8min Sweet Spot intervals directly to my Apple Watch or Garmin without memorizing the numbers?",
      response: "Done! Tap 'Push to Watch' on today's workout card. For Apple Watch, it syncs directly via native WorkoutKit with exact power targets (260W–285W) and haptic countdown beeps. For Garmin, it syncs onto your Garmin Connect Calendar. Just press Start on your wrist!",
      avatar: "images/avatars/strict-default.png",
      coachName: "Coach Rooka (Strict Data Tone)"
    },
    hyrox: {
      question: "I'm 6 weeks out from my Hyrox event. How should I balance heavy sled pushes and wall balls with my 10km running intervals without blowing up my legs?",
      response: "To build peak hybrid capacity without overreaching, we'll implement concurrent training separation. Perform your compromised running sessions (e.g. 1km run into 50m Sled Push simulation) on high-readiness days (Rooka Score > 80). Keep your pure heavy strength work 48 hours separated from threshold intervals, and prioritize posterior-chain recovery with targeted carbohydrate timing.",
      avatar: "images/avatars/strict-default.png",
      coachName: "Coach Rooka (Strict Data Tone)"
    },
    taper: {
      question: "I have my target 70.3 Ironman in 10 days. How should my PMC fitness vs fatigue balance look?",
      response: "For optimal race-day execution, we want your Training Stress Balance (TSB Form) between +12 and +20 while retaining 92%+ of your Chronic Training Load (CTL Fitness). Starting today, cut total workout volume by 40% but keep race-pace neuromuscular bursts (e.g. 4x30s at 70.3 race watts). This keeps your engine primed while clearing deep systemic fatigue.",
      avatar: "images/avatars/cheer-hype.png",
      coachName: "Coach Rooka (Positive Cheerleader Tone)"
    }
  };

  if (simTabBtns.length > 0 && userQueryEl && coachResponseEl) {
    simTabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        simTabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const tabKey = btn.dataset.tab;
        const data = coachSimData[tabKey];
        if (data) {
          userQueryEl.style.opacity = '0';
          coachResponseEl.style.opacity = '0';
          if (simAvatarImg) simAvatarImg.style.opacity = '0';

          setTimeout(() => {
            userQueryEl.textContent = `"${data.question}"`;
            coachResponseEl.textContent = data.response;
            if (simAvatarImg) {
              simAvatarImg.src = data.avatar;
              simAvatarImg.style.opacity = '1';
            }
            if (simCoachName) simCoachName.textContent = data.coachName;
            userQueryEl.style.opacity = '1';
            coachResponseEl.style.opacity = '1';
          }, 180);
        }
      });
    });
  }

  // Persona Card Interactive Selection
  const personaCards = document.querySelectorAll('.persona-card');
  if (personaCards.length > 0) {
    personaCards.forEach(card => {
      card.addEventListener('click', () => {
        personaCards.forEach(c => c.classList.remove('active-persona'));
        card.classList.add('active-persona');
      });
    });
  }

  // 3. Interactive App Screenshot Showcase / Tour
  const tourTabs = document.querySelectorAll('.tour-tab-btn');
  const tourImage = document.getElementById('tour-screenshot-img');
  const tourTitle = document.getElementById('tour-feature-title');
  const tourDesc = document.getElementById('tour-feature-desc');
  const tourTags = document.getElementById('tour-feature-tags');

  const tourData = {
    planning: {
      src: 'images/screenshot-planning.png',
      alt: 'Rooka Adaptive Planning and Periodization',
      title: 'Smart Phase-Based Periodization',
      desc: 'Dynamic 4-phase periodization (Adapt, Develop, Crunch, Sustain) that automatically adjusts workout density, structured swim/bike/run intervals, and recovery blocks with one-tap Adapt.',
      tags: ['One-Tap Adapt', 'Apple Watch WorkoutKit Push', 'Garmin Calendar Sync', 'Rest Day Calibration']
    },
    chat: {
      src: 'images/screenshot-chat.png',
      alt: 'Rooka 24/7 AI Coach Chat Interface',
      title: '24/7 Conversational AI Coach',
      desc: 'Real-time workout debriefs, AI food photo scanning, physiological insights, weather-informed pacing adjustments, and race-day tactics tuned to your customized coach persona.',
      tags: ['Google Gemini 2.0 AI', 'Meal Photo Macro Scan', 'Segment PR Analysis', 'Voice & Text Support']
    },
    progress: {
      src: 'images/screenshot-progress.png',
      alt: 'Rooka Progress, Archetype Radar and PMC Telemetry',
      title: 'Athlete Archetype & PMC Telemetry',
      desc: 'Scientific 5-axis capability radar tracking Endurance, Strength, Explosiveness, Versatility, and Consistency, combined with pro-grade CTL (Fitness), ATL (Fatigue), and TSB (Form) modeling.',
      tags: ['5-Axis Radar Chart', 'Fitness (CTL)', 'Fatigue (ATL)', 'Readiness Score (TSB)']
    },
    nutrition: {
      src: 'images/screenshot-nutrition.png',
      alt: 'Rooka Targeted Macro Fueling and Nutrient Timing',
      title: 'Targeted Macro Fueling & Timing',
      desc: 'Precision intra-workout and daily nutrition tailored directly to workout intensity. Know exactly when and how many carbs, proteins, and electrolytes to consume for optimal glycogen replenishment.',
      tags: ['Pre/Intra/Post Timing', 'Macro Grams Calculator', 'Threshold Fueling', 'Hydration & Electrolytes']
    },
    fatigue: {
      src: 'images/screenshot-fatigue.png',
      alt: 'Rooka 7-Day Muscle Fatigue Model & Injury Prevention',
      title: '7-Day Muscle Fatigue & Niggle Model',
      desc: 'Granular biomechanical workload modeling across Quads, Calves & Achilles, Hamstrings, Glutes, Core, and Upper Body to flag asymmetrical stress and prevent overuse.',
      tags: ['Workload Heatmaps', 'Niggle Logger', 'Injury Prevention', 'Biomechanical Balance']
    },
    social: {
      src: 'images/screenshot-social.png',
      alt: 'Rooka Social Feed, Quests & Community Leaderboard',
      title: 'Quests, Titles & Social Feed',
      desc: 'Connect with training partners, share workout achievements, send sparks, and earn bonus Rooka points on weekly quests to level up your athletic rank.',
      tags: ['Community Leaderboard', 'Weekly Quests', 'Athlete Titles', 'Sparks & Kudos']
    }
  };

  if (tourTabs.length > 0 && tourImage) {
    tourTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tourTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        const key = tab.dataset.tour;
        const item = tourData[key];
        if (item) {
          tourImage.style.opacity = '0';
          tourImage.style.transform = 'scale(0.97)';
          if (tourTitle) tourTitle.style.opacity = '0';
          if (tourDesc) tourDesc.style.opacity = '0';
          if (tourTags) tourTags.style.opacity = '0';

          setTimeout(() => {
            tourImage.src = item.src;
            tourImage.alt = item.alt;
            if (tourTitle) tourTitle.textContent = item.title;
            if (tourDesc) tourDesc.textContent = item.desc;
            if (tourTags) {
              tourTags.innerHTML = item.tags.map(t => `<span class="tour-badge">${t}</span>`).join('');
            }

            tourImage.style.opacity = '1';
            tourImage.style.transform = 'scale(1)';
            if (tourTitle) tourTitle.style.opacity = '1';
            if (tourDesc) tourDesc.style.opacity = '1';
            if (tourTags) tourTags.style.opacity = '1';
          }, 180);
        }
      });
    });
  }

  // 4. Hero Quick Screenshot Switcher
  const heroPills = document.querySelectorAll('.hero-screen-pill');
  const heroPhoneImg = document.getElementById('hero-mockup-img');
  if (heroPills.length > 0 && heroPhoneImg) {
    heroPills.forEach(pill => {
      pill.addEventListener('click', () => {
        heroPills.forEach(p => p.classList.remove('active'));
        pill.classList.add('active');

        const screenSrc = pill.dataset.screen;
        if (screenSrc) {
          heroPhoneImg.style.opacity = '0';
          setTimeout(() => {
            heroPhoneImg.src = screenSrc;
            heroPhoneImg.style.opacity = '1';
          }, 150);
        }
      });
    });
  }

  // 5. Mobile Menu Toggle
  const mobileToggle = document.querySelector('.mobile-toggle');
  const navMenu = document.querySelector('.nav-menu');
  if (mobileToggle && navMenu) {
    mobileToggle.addEventListener('click', () => {
      navMenu.classList.toggle('open');
    });
  }

  // 6. Smooth scrolling for internal anchors
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
      const targetId = this.getAttribute('href');
      if (targetId && targetId !== '#') {
        const targetElement = document.querySelector(targetId);
        if (targetElement) {
          e.preventDefault();
          targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
          if (window.innerWidth <= 768 && navMenu) {
            navMenu.classList.remove('open');
          }
        }
      }
    });
  });

  // 7. Early access / TestFlight form handler with email dispatch to rutgervandenberg@live.nl
  const betaForm = document.getElementById('beta-signup-form');
  const betaSuccessMsg = document.getElementById('beta-success-msg');
  if (betaForm) {
    betaForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const emailInput = betaForm.querySelector('input[type="email"]');
      const submitBtn = betaForm.querySelector('button[type="submit"]');
      
      if (emailInput && emailInput.value) {
        const email = emailInput.value.trim();

        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.innerHTML = 'Sending...';
        }

        // 1. Dispatch email notification to rutgervandenberg@live.nl via FormSubmit AJAX API
        const emailPromise = fetch('https://formsubmit.co/ajax/rutgervandenberg@live.nl', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({
            email: email,
            _subject: `New Rooka TestFlight Beta Invite Request: ${email}`,
            _template: 'table',
            _captcha: 'false',
            applicant_email: email,
            source: 'rooka.io landing page',
            submitted_at: new Date().toLocaleString()
          })
        }).catch(err => console.warn('FormSubmit notification error:', err));

        // 2. Also record in local waitlist DB if backend server is online
        const serverPromise = fetch('/api/auth/waitlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email, notes: 'Website TestFlight Request' })
        }).catch(err => console.warn('Local waitlist error:', err));

        // Display instant clean confirmation
        Promise.allSettled([emailPromise, serverPromise]).then(() => {
          betaForm.style.display = 'none';
          if (betaSuccessMsg) {
            betaSuccessMsg.innerHTML = `✓ Request received for <strong style="color: white;">${email}</strong>! We've dispatched an email notification to <strong>rutgervandenberg@live.nl</strong> and you'll receive your TestFlight invitation shortly.`;
            betaSuccessMsg.style.display = 'block';
          }
        });
      }
    });
  }
});

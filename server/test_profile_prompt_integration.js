const assert = require("assert");
const db = require("./services/db");

console.log("🏃 Running Athlete Profile Prompt Integration Tests...\n");

// Helper mimicking chat.js availability parser
function formatAvailability(availability) {
  let availabilityText = "No specific schedule boundaries or daily duration limits set.";
  if (availability) {
    try {
      const availObj = typeof availability === 'string'
        ? JSON.parse(availability)
        : availability;
      if (availObj && typeof availObj === 'object' && Object.keys(availObj).length > 0) {
        const dayOrder = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        const dayNames = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };
        const formattedDays = [];

        dayOrder.forEach((d) => {
          const match = availObj[d] || availObj[d.toLowerCase()] || availObj[d.toUpperCase()] ||
            availObj[dayNames[d]] || availObj[dayNames[d].toLowerCase()];
          if (match) {
            const isAvail = match.available !== false && match.status !== 'blocked';
            const maxM = match.maxMinutes !== undefined ? match.maxMinutes : (match.max_minutes !== undefined ? match.max_minutes : 0);
            formattedDays.push(`- ${dayNames[d]}: ${isAvail && maxM > 0 ? `Available (Max: ${maxM} min)` : 'Rest day / Blocked (0 min)'}`);
          }
        });

        Object.entries(availObj).forEach(([day, data]) => {
          const dNorm = day.slice(0, 3).toLowerCase();
          const matchedOrder = dayOrder.some(d => d.toLowerCase() === dNorm);
          if (!matchedOrder && data) {
            const isAvail = data.available !== false && data.status !== 'blocked';
            const maxM = data.maxMinutes ?? data.max_minutes ?? 0;
            formattedDays.push(`- ${day.charAt(0).toUpperCase() + day.slice(1)}: ${isAvail && maxM > 0 ? `Available (Max: ${maxM} min)` : 'Rest day / Blocked (0 min)'}`);
          }
        });

        if (formattedDays.length > 0) {
          availabilityText = formattedDays.join("\n                    ");
        }
      }
    } catch (e) {
      console.error("Error parsing training_availability:", e);
    }
  }
  return availabilityText;
}

// Helper mimicking recurring trainings formatting
function formatRecurringTrainings(recurringRows) {
  let recurringTrainingsText = "No recurring weekly sports configured.";
  if (recurringRows && recurringRows.length > 0) {
    recurringTrainingsText = recurringRows
      .map(
        (r) =>
          `- ${r.day_of_week}: "${r.title}" (Sport: ${r.sport || 'Other'}, Duration: ${r.duration_minutes || 60}m, Intensity: ${r.intensity || 'moderate'}${r.start_time ? `, Start Time: ${r.start_time}` : ''})`
      )
      .join("\n                    ");
  }
  return recurringTrainingsText;
}

// Test 1: Daily Availability Parsing with modern format ({ available, maxMinutes })
{
  const modernAvailability = {
    Mon: { available: true, maxMinutes: 60 },
    Tue: { available: false, maxMinutes: 0 },
    Wed: { available: true, maxMinutes: 45 },
    Thu: { available: true, maxMinutes: 30 },
    Fri: { available: false, maxMinutes: 0 },
    Sat: { available: true, maxMinutes: 90 },
    Sun: { available: true, maxMinutes: 120 }
  };
  const parsed = formatAvailability(modernAvailability);
  assert.ok(parsed.includes("Monday: Available (Max: 60 min)"), "Monday 60 min");
  assert.ok(parsed.includes("Tuesday: Rest day / Blocked (0 min)"), "Tuesday Rest day");
  assert.ok(parsed.includes("Wednesday: Available (Max: 45 min)"), "Wednesday 45 min");
  assert.ok(parsed.includes("Thursday: Available (Max: 30 min)"), "Thursday 30 min");
  assert.ok(parsed.includes("Friday: Rest day / Blocked (0 min)"), "Friday Rest day");
  assert.ok(parsed.includes("Saturday: Available (Max: 90 min)"), "Saturday 90 min");
  assert.ok(parsed.includes("Sunday: Available (Max: 120 min)"), "Sunday 120 min");
  console.log("✅ Test 1 Passed: Modern availability format parsed with daily caps and rest days");
}

// Test 2: JSON string format & legacy format compatibility
{
  const legacyJsonStr = JSON.stringify({
    monday: { status: "available", max_minutes: 50 },
    tuesday: { status: "blocked", max_minutes: 0 }
  });
  const parsed = formatAvailability(legacyJsonStr);
  assert.ok(parsed.includes("Monday: Available (Max: 50 min)"), "Legacy Monday");
  assert.ok(parsed.includes("Tuesday: Rest day / Blocked (0 min)"), "Legacy Tuesday");
  console.log("✅ Test 2 Passed: Legacy and JSON string availability format correctly parsed");
}

// Test 3: Recurring Trainings Formatting
{
  const mockRecurring = [
    { title: "Tuesday Football Match", day_of_week: "Tuesday", sport: "Soccer", duration_minutes: 90, intensity: "high", start_time: "19:30" },
    { title: "Thursday Tennis Club", day_of_week: "Thursday", sport: "Tennis", duration_minutes: 60, intensity: "moderate", start_time: "18:00" }
  ];
  const formatted = formatRecurringTrainings(mockRecurring);
  assert.ok(formatted.includes('Tuesday: "Tuesday Football Match" (Sport: Soccer, Duration: 90m, Intensity: high, Start Time: 19:30)'), "Tuesday soccer");
  assert.ok(formatted.includes('Thursday: "Thursday Tennis Club" (Sport: Tennis, Duration: 60m, Intensity: moderate, Start Time: 18:00)'), "Thursday tennis");
  console.log("✅ Test 3 Passed: Recurring sports formatted with title, sport, duration, intensity, and start time");
}

// Test 4: Verify chat.js source contains availability and recurring trainings prompt integration
{
  const fs = require("fs");
  const path = require("path");
  const chatSource = fs.readFileSync(path.join(__dirname, "routes/chat.js"), "utf8");

  assert.ok(chatSource.includes("training_availability FROM users WHERE id = ?"), "chat.js selects training_availability");
  assert.ok(chatSource.includes("SELECT title, day_of_week, start_time, duration_minutes, sport, intensity FROM recurring_trainings"), "chat.js queries recurring_trainings");
  assert.ok(chatSource.includes("DAILY EXERCISE LIMITATIONS & WEEKLY SCHEDULE BOUNDARIES:"), "chat.js injects availability into prompt");
  assert.ok(chatSource.includes("RECURRING SPORTS & PERIODICAL TRAININGS (NON-ROOKA ACTIVITIES):"), "chat.js injects recurring sports into prompt");
  assert.ok(chatSource.includes("DAILY EXERCISE LIMITATIONS & TIME BUDGET COMPLIANCE (CRITICAL)"), "chat.js enforces daily limits");
  assert.ok(chatSource.includes("RECURRING SPORTS & PERIODICAL TRAININGS HARMONY (CRITICAL)"), "chat.js enforces recurring sports harmony");
  console.log("✅ Test 4 Passed: chat.js source code verified for prompt injection and critical rules");
}

// Test 5: Verify activities.js source contains availability and recurring trainings
{
  const fs = require("fs");
  const path = require("path");
  const actSource = fs.readFileSync(path.join(__dirname, "routes/activities.js"), "utf8");

  assert.ok(actSource.includes("Daily Exercise Limitations & Schedule Boundaries:"), "activities.js injects boundaries");
  assert.ok(actSource.includes("Recurring Sports & Periodical Trainings (Non-Rooka Activities):"), "activities.js injects recurring sports");
  assert.ok(actSource.includes("DAILY EXERCISE LIMITATIONS & RECURRING SPORTS (CRITICAL)"), "activities.js enforces boundaries and recurring sports");
  console.log("✅ Test 5 Passed: activities.js source code verified for prompt injection and critical rules");
}

// Test 6: Verify utils.js morning message includes availability & recurring trainings
{
  const fs = require("fs");
  const path = require("path");
  const utilsSource = fs.readFileSync(path.join(__dirname, "services/utils.js"), "utf8");

  assert.ok(utilsSource.includes("u.training_availability"), "utils.js selects training_availability");
  assert.ok(utilsSource.includes("FROM recurring_trainings"), "utils.js queries recurring_trainings in morning message");
  assert.ok(utilsSource.includes("todayAvailabilityNote"), "utils.js checks today's availability limit");
  assert.ok(utilsSource.includes("todayRecurringNote"), "utils.js checks today's recurring sport");
  console.log("✅ Test 6 Passed: utils.js morning message verified for daily limits and recurring sports");
}

console.log("\n🎉 All 6 Athlete Profile Prompt Integration tests passed successfully!");
process.exit(0);

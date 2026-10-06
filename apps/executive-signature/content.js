(function () {
  'use strict';

  window.READINESS_CONTENT = {
    schemaVersion: 1,
    contentVersion: '1.1.0',
    scoreRubric: [
      ['What it measures', 'How you describe your current habits in three areas: finishing what you start, staying clear under pressure and taking on unfamiliar problems.'],
      ['What goes into it', 'The plain average of Follow-through, Steadiness and Curiosity. The full facet report instead averages six facets: Achievement-Striving, Self-Discipline, Orderliness, Intellect, Anxiety (flipped) and Self-Consciousness (flipped).'],
      ['Keep in mind', 'This is a short self-report assessment. There are no right answers or pass marks. Your answers may vary with your role, circumstances and the day you take it.'],
      ['Why two areas are left out', 'Social energy and Warmth describe how you tend to work with people. UTL does not treat either end as better. These two shape your profile instead of your score.'],
      ['What a 100 means', 'The top answer on every readiness question. It is the edge of the scale, not the goal. 80 and above is already the top band, and a score above 90 is worth checking against how colleagues see you.']
    ],
    bands: [
      { id: 'emerging', label: 'Emerging', min: 0, max: 39, looksLike: 'You often need a deadline or a reminder to finish. Pressure can knock your thinking off course. You tend to stick with the familiar way.', nextStep: 'Pick one area and one habit for the next 30 days. The area with the lowest score is usually the best place to start.' },
      { id: 'developing', label: 'Developing', min: 40, max: 59, looksLike: 'You are dependable on most things. One area, often steadiness under pressure or finishing without being chased, slows you down.', nextStep: 'Close the one gap that would move your score the most. The result names it.' },
      { id: 'strong', label: 'Strong', min: 60, max: 79, looksLike: 'Your answers suggest that you usually stay clear in tense moments, finish what you take on and work through hard problems.', nextStep: 'Sharpen one area and take on one piece of stretch work, such as leading a meeting or owning a project end to end.' },
      { id: 'exceptional', label: 'Very strong', min: 80, max: 100, looksLike: 'Your answers suggest strong habits across finishing work, staying clear under pressure and taking on unfamiliar problems.', nextStep: 'Choose one stretch assignment where these habits will matter. Watch for overuse, such as holding on to plans or taking on too much yourself.' }
    ],
    areas: {
      Conscientiousness: {
        name: 'Follow-through', kind: 'readiness',
        definition: 'How reliably you plan your work, keep it organized and finish it without being chased.',
        not: 'How smart or talented you are, or how many hours you put in.',
        read: 'Higher means a stronger habit. Very high can tip into holding on to a plan after it stops working.',
        why: 'Executive work comes with less checking. People need to trust that what you own gets done.',
        levels: {
          Low: { range: '0–39', looksLike: 'You start strong, then things slip without a deadline or a reminder. Plans live in your head.', tryThis: "Write tomorrow's three tasks down before you log off. Close each one before you start something new." },
          Mid: { range: '40–60', looksLike: 'You get the important things done on time. Small details slide when you are busy.', tryThis: 'Keep one running list and clear it every Friday.' },
          High: { range: '61–100', looksLike: 'You finish what you start without being chased. People plan around you.', tryThis: 'Hand one task a week to someone else and let them do it their way.' }
        }
      },
      Neuroticism: {
        name: 'Steadiness', kind: 'readiness',
        definition: 'How calm and clear you stay under pressure, and how fast you recover from a bad day.',
        not: 'Whether you have feelings or hide them. Steady people feel stress too. It throws them off less.',
        read: 'Higher means pressure throws you off less. Very high can mean missing how stressed other people are.',
        why: 'Senior roles bring more pressure, and more people watch how you react to it.',
        levels: {
          Low: { range: '0–39', looksLike: 'Pressure reaches you fast. A bad meeting can stay with you for the rest of the day.', tryThis: 'Wait ten minutes before replying to the next message that gets under your skin. Write down the one thing you need.' },
          Mid: { range: '40–60', looksLike: 'You stay level most days. The hardest weeks still get to you.', tryThis: 'Block one hour after your hardest weekly meeting before taking on work that needs a clear head.' },
          High: { range: '61–100', looksLike: 'You stay calm when things get loud. Other people borrow your calm.', tryThis: 'Before you solve the next tense problem, name what the room is feeling.' }
        }
      },
      Intellect: {
        name: 'Curiosity', kind: 'readiness',
        definition: 'How much you enjoy ideas, hard problems and learning new ways of doing things.',
        not: 'An IQ score or a measure of how much schooling you have.',
        read: 'Higher means you go after hard problems and new ideas. Very high can mean chasing what is interesting over what is important.',
        why: 'Executive work brings problems with no playbook, and tools like AI keep changing how the work gets done.',
        levels: {
          Low: { range: '0–39', looksLike: 'You prefer ideas you can use tomorrow. You judge an idea by whether it works.', tryThis: 'Once a week, ask why one more time before accepting the first answer.' },
          Mid: { range: '40–60', looksLike: 'You enjoy an idea when it connects to real work.', tryThis: 'Read one thing outside your field each week and write down where it connects to your work.' },
          High: { range: '61–100', looksLike: 'You enjoy hard problems and new ideas for their own sake. You learn new tools fast.', tryThis: 'For every new idea you save, write the next step and owner beside it.' }
        }
      },
      Extraversion: {
        name: 'Social energy', kind: 'style',
        definition: 'How much energy you get from being around people, and how readily you speak up and take the floor.',
        not: 'How good you are with people, or whether you can lead.',
        read: 'Neither end is better. It shows how you lead, from the front or one on one, and not whether you can.',
        why: 'It shapes how people experience you as a leader, in the big meeting or in the quiet follow-up.',
        levels: {
          Low: { range: '0–39', looksLike: 'You recharge on your own and speak once you have something worth saying.', tryThis: 'In the next group meeting, say one thing in the first ten minutes.' },
          Mid: { range: '40–60', looksLike: 'You can work a room when you need to and still enjoy time alone.', tryThis: 'Before each meeting, decide whether you need to lead the room or listen closely.' },
          High: { range: '61–100', looksLike: 'You get energy from people and are often the first to start the conversation.', tryThis: 'In the next meeting, ask two people for their view before giving yours.' }
        }
      },
      Agreeableness: {
        name: 'Warmth', kind: 'style',
        definition: 'How much you notice how others feel and how much effort you put into working well with them.',
        not: 'Being nice, or being easy to push around.',
        read: 'Neither end is better. Lower often means straight talk. Higher often means trust and loyalty.',
        why: 'It shapes why people follow you, because they trust you or because you are clear and firm.',
        levels: {
          Low: { range: '0–39', looksLike: 'You say what you think, even when people do not want to hear it.', tryThis: 'Before your next hard feedback conversation, name one thing the person is doing well.' },
          Mid: { range: '40–60', looksLike: 'You care how people feel and can still hold a hard line.', tryThis: 'Before a hard conversation, decide what the person needs to hear and what they need from you.' },
          High: { range: '61–100', looksLike: 'You notice how people feel and act on it. Colleagues come to you when something is wrong.', tryThis: 'Say no to one request this week that the other person can handle without you.' }
        }
      }
    },
    facets: {
      'Achievement-Striving': { group: 'readiness', strength: 'You set a high bar for your own work and keep pushing toward it.', growthEdge: 'You may do what is asked and stop there. Picking one goal to push past is a good place to start.' },
      'Self-Discipline': { group: 'readiness', strength: 'You follow through on commitments without needing a reminder.', growthEdge: 'Structure helps you more than open-ended ownership does.' },
      Orderliness: { group: 'readiness', strength: 'You keep your work organized, so others can pick it up and understand it.', growthEdge: 'A simple system for tracking tasks would give back time you now lose to searching and redoing.' },
      Intellect: { group: 'readiness', strength: 'You enjoy hard problems and can hold a lot of information at once.', growthEdge: 'You may reach for the quick answer when a decision deserves another hour of thinking.' },
      Anxiety: { group: 'readiness', strength: 'A high-stakes meeting does not throw off your thinking.', growthEdge: 'A tense meeting can stay with you longer than it should.' },
      'Self-Consciousness': { group: 'readiness', strength: 'You are comfortable speaking up in rooms where you are the least senior person.', growthEdge: 'You may hold back in unfamiliar settings until you feel sure. Speaking earlier, even briefly, gets your thinking into the room.' },
      Assertiveness: { group: 'style', levels: { Low: 'You tend to let others lead and step in when your view is needed.', Mid: 'You lead when the situation calls for it and follow when someone else is better placed.', High: 'You take charge easily and people often look to you to set direction.' } },
      'Activity Level': { group: 'style', levels: { Low: 'You prefer a steady pace and doing fewer things well.', Mid: 'You can speed up when needed but would rather not live at that pace.', High: 'You like a full calendar and move fast between tasks.' } },
      Cooperation: { group: 'style', levels: { Low: 'You are willing to push back and argue a point when you disagree.', Mid: 'You pick your battles and avoid conflict that does not matter.', High: 'You avoid friction and work hard to keep things smooth between people.' } },
      Altruism: { group: 'style', levels: { Low: 'You focus on the task and trust people to ask when they need help.', Mid: 'You help when you see a need and keep your own work moving.', High: 'You go out of your way for others, often before they ask.' } }
    }
  };
}());

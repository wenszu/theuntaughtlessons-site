(function () {
  const testimonials = [
    {
      name: "Aldon Acenas",
      role: "Management Trainee · Uber",
      quote: "I was able to be more open to risk and embrace change. The forward mentality that emanates from all our interactions — be it about the age of AI or how to be a kind person and a good teammate — will always stick. I learned that fear is an invitation to evolve."
    },
    {
      name: "Nitant K.",
      role: "Vendor Manager · Uber",
      quote: "Working with Wen-Szu for over 4 years, I realized that as long as you keep focus on the paramount business objective and get people to work as a team, things ultimately get delivered. If you have the right business objective, the rest falls in place."
    },
    {
      name: "Chloe T.",
      role: "Engagement Specialist · Uber",
      quote: "While I was a campus recruiter, it was a pleasure to work closely with the CommOps team and look for bright talent for Uber. The highlight was the SOAR seminar, when we all came together to carry out the seminar for the students."
    },
    {
      name: "Morelyn M.",
      role: "Program Specialist IV · Uber",
      quote: "Working with you reshaped the way I think. You introduced me to the discipline of BSP and the power of structured thinking, helping me approach challenges with clarity and intention. Yet you also showed me that there's room for spontaneity — that sometimes the most meaningful progress comes from simply trusting your instincts."
    },
    {
      name: "Soumya Sulegai",
      role: "APAC University Manager · Uber",
      quote: "Understanding the North Asia market from a university standpoint — what students look for when exploring career opportunities — was shaped by how you act fast and bring all stakeholders together with shared ownership and accountability."
    },
    {
      name: "Peichieh L.",
      role: "Program Specialist · Uber",
      quote: "Structured thinking is one of the most transformative skill sets I've learned. Frameworks like MECE, the pyramid principle, and storytelling structures fundamentally changed not just how I communicate, but how I think. This framework-driven way of thinking gives me a strong backbone to build on."
    },
    {
      name: "Wei Chou (Richard) Chung",
      role: "Program Specialist – Management Trainee · Uber",
      quote: "You helped me see my move from finance into tech as an intentional path, not an accidental detour. I started treating my rotations as learning experiments instead of pass-or-fail tests. I now feel more confident navigating uncertainty and telling my own story."
    },
    {
      name: "Sreekar M.",
      role: "Program Leader, INSA CX · Uber",
      quote: "The emphasis on structured thinking, communication, and executive communication are lessons I will carry with me wherever I go — especially BSP and the 'power of three.'"
    },
    {
      name: "John L.",
      role: "Management Trainee · Uber",
      quote: "Communicating with MECE and BSP fundamentally changed how I structure communication. I remember you said that rotations might not help us find what we like, but they help us discover what we don't like. That mindset helped me a lot during challenging moments."
    },
    {
      name: "Candice Chou",
      role: "Program Specialist – Management Trainee · Uber",
      quote: "The biggest impact for me was gaining confidence. The 'untaught lessons' you shared gave me a real framework for problem-solving I could immediately test and use. You showed me that life isn't limited by a job title, and that's been a massive perspective shift for me."
    },
    {
      name: "Julie C.",
      role: "Program Specialist III – Management Trainee · Uber",
      quote: "The biggest impact was learning to use BSP. In my first few months at Uber, multiple teammates and managers reminded me to frame my slide bullet points into BSP, which made my communication much clearer and more impactful. It shaped not only how I present information, but also how I think."
    },
    {
      name: "Ritesh Kumar Singh",
      role: "Senior Program Leader, CommOps · Uber",
      quote: "Wen-Szu's emphasis on strengthening problem-solving capabilities through foundational principles such as structured thinking, MECE, and effective business communication using storytelling frameworks has been instrumental in my personal and professional development. These lessons will stay with me throughout my career."
    },
    {
      name: "Neha G.",
      role: "Senior Program Leader, CommOps · Uber",
      quote: "By far the most important skill Wen-Szu imparted was cutting through communication. The principles of BSP and strategic storytelling were instrumental in elevating our executive presence and providing clarity of thought. He has an uncanny superpower to build both great processes and great talent."
    },
    {
      name: "Raul M.",
      role: "Head of CX, Japan & South Korea · Uber",
      quote: "Wen-Szu's guidance on structured communication increased my impact, visibility, and leadership presence. It pushed me to focus on the outcome, break down problems effectively, and present only the most relevant information as clearly as possible. It has now become a habit that drives efficient, structured communication across all my activities."
    },
    {
      name: "Mitch V.",
      role: "Senior CommOps Manager · Uber",
      quote: "The most memorable thing: on my 3rd day at Uber, I drafted a 3-paragraph email and you said it was too long and didn't read it. You reinforced the bolded summary phrase style — which I use to this day and find very useful. I even teach it to my direct reports."
    },
    {
      name: "Roy M.",
      role: "Head of Product Insights & Rollouts, APAC & EMEA · Uber",
      quote: "It's rare to find leaders whose teams genuinely admire them. Wen-Szu achieves this by nurturing talent, matching people to their strengths, and creating an environment where everyone can thrive. He invests deeply in coaching and ensures his teams have the focus and space to do their best work."
    },
    {
      name: "Lia P.",
      role: "Program Specialist · Uber",
      quote: "I learned foundational skills that helped me structure, problem-solve, and communicate more effectively — which ultimately helped open new opportunities. I've always appreciated Wen-Szu's desire to champion young, Filipino talent and create opportunities that would otherwise not be available."
    },
    {
      name: "Fenton C.",
      role: "Head of Community Operations · Uber",
      quote: "My time working with Wen-Szu was transformational for my career. His guidance helped me develop a highly structured thought process that I use daily. The coaching on storytelling was incredibly useful, providing me with the essential skills needed to pitch ideas and present complex proposals to executives."
    },
    {
      name: "Nadun K.",
      role: "Senior Greenlight Manager · Uber",
      quote: "Our work together introduced me to countless proven and simple tools that fundamentally changed how I operate — from enhancing my communication and prioritizing my workload, to effectively managing stakeholders and shaping my entire leadership approach."
    },
    {
      name: "Robert Kueh",
      role: "Senior Learning Team Lead, Global L&D · Uber",
      quote: "Wen-Szu has been instrumental in mentoring me on integrating AI into Learning & Development. He doesn't just champion the idea; he keeps me laser-focused on delivering measurable outcomes, and I'm truly grateful for that guidance."
    },
    {
      name: "Genevieve F.",
      role: "Head of CommOps, Japan and South Korea · Uber",
      quote: "I worked in Wen-Szu's organization of thousands. The largest organization I ever worked in was also the most psychologically safe, with the strongest communication network. I've stood up many of his practices in my team today — at 1/100th the size, his practices are still absolutely effective."
    },
    {
      name: "Kelly T.",
      role: "Management Trainee · Uber",
      quote: "Our conversations have shown me that you are constantly innovating. Your drive for new books, business ventures, start-up ideas, and continuous self-improvement is truly inspiring. This has motivated me to explore the opportunities available in my own life and define a different pathway for myself."
    },
    {
      name: "Anonymous",
      role: "Program Specialist IV · Uber",
      quote: "Our work together significantly strengthened my structured thinking, especially when preparing leadership-facing materials. I'm now more confident approaching decks with a clearer narrative and a better understanding of what senior leaders actually care about."
    },
    {
      name: "Julia H.",
      role: "Director CX, APAC Delivery and Global Direct · Uber",
      quote: "Wen-Szu models reflective thinking and invites others to do so. His approach to swap assumptions for questions and sharpen my cultural lens led me to slow down and find team harmony so momentum feels shared, not imposed."
    },
    {
      name: "Julia E. Q.",
      role: "Management Trainee · Uber",
      quote: "Wen-Szu's nuggets of wisdom shared in 40-minute lunch windows, grabbing water in the pantry, or even just in casual conversation, will always stay with me. He inspires me to think and communicate efficiently — a principle I try to bring not just to my work but to my daily life too."
    },
    {
      name: "Chris Chang",
      role: "Senior CommOps Manager · Uber",
      quote: "Our focus on written communication has fundamentally shifted my career trajectory. Using writing as a forcing function to clarify my own thoughts, crafting persuasive narratives to secure buy-in, and documenting insights to extend my reach beyond physical meetings — these skills changed everything."
    },
    {
      name: "Anonymous",
      role: "Program Specialist III – Management Trainee · Uber",
      quote: "Your learning sessions have really helped ingrain concepts such as MECE and BSP in my head. They help me structure my thoughts better — working, thinking, and communicating smarter. Our casual conversations have also inspired me to take on 30-day challenges that help me build habits I've always wanted to form."
    },
    {
      name: "Jihae Choi (Joy)",
      role: "CX Program Leader · Uber",
      quote: "Instead of broadly communicating every detail, I now focus on storytelling around the core message. I had become afraid of presenting on Zoom — but through Wen-Szu's MBR sessions and presenting to executives every month, I've gained confidence and found my own style."
    },
    {
      name: "Regina M.",
      role: "SOAR Management Trainee · Uber",
      quote: "Working with Wen-Szu is the kind of experience that shapes you through his guiding principles and methods. His strong push for BSP and MECE encouraged us to think deeply and consider more complex nuances. Thinking with specific principles allows you to be clearer and more intentional."
    },
    {
      name: "Joshua Pielago",
      role: "Program Leader, Community Operations · Uber",
      quote: "Wen-Szu taught me how to think properly — MECE, structured problem-solving, the basics that made me actually effective instead of just busy. He gave me space to experiment and fail, then stepped in with feedback when it mattered. That balance of trust and guidance is the kind of leadership that actually develops people."
    },
    {
      name: "Anonymous",
      role: "Lead, Consumer Experience · Uber",
      quote: "Wen-Szu helped me become better at working across markets and cultures with APAC teams. He showed me how to subtly adjust my approach based on different cultural styles — things like how people handle conflict, pace decisions, or give input. It changed how I see collaboration."
    },
    {
      name: "Kevin Cena",
      role: "Program Lead · Uber",
      quote: "My biggest shift was moving away from long, detailed presentations to a model of effective, concise communication. I learned that true effort lies in distilling complex information into simple, powerful one-pagers. Dumping information is the lazy route; clarity through brevity is the disciplined, effective approach."
    },
    {
      name: "Ashish B.",
      role: "Director, APAC Field Ops · Uber",
      quote: "Wen-Szu's style of leadership gave me all the ingredients to be successful in my early years at Uber. The feedback was prompt, direct, and topical — it created a safe space for me to know I had a partner and not a judge in him."
    },
    {
      name: "Pixy Prassad",
      role: "APAC L&D Delivery Lead · Uber",
      quote: "Working with a visionary leader amplifies learning opportunities. Your farsightedness helps you incorporate change early and be prepared for the coming years well in advance. You always push to not just think about the problem, but to solution it quickly."
    },
    {
      name: "Japh V.",
      role: "Senior CommOps Manager · Uber",
      quote: "You have the ability to move people, even during onboarding. Watching you in a recorded video be authentically yourself as you discuss topics during CommBoarding inspired me to create my own path and my own journey at Uber faster."
    },
    {
      name: "Prashant C.",
      role: "Senior Program Leader, CommOps · Uber",
      quote: "Working with you fundamentally raised the bar for what leadership delivery looks like. Your 'untaught lessons' around structured thinking, BSP-style communication, and focusing on the real so-what helped me move from being a strong operator to someone who can frame problems, influence across functions, and drive change at system scale."
    },
    {
      name: "Sidd S.",
      role: "Program Lead, CommOps · Uber",
      quote: "Working with Wen-Szu materially lifted how I communicate with senior audiences. His 'less is more' approach sharpened my thinking and improved stakeholder alignment. Bold statement phrases to anchor communication for senior audiences is now embedded in my day-to-day approach — and something I actively coach my own teams on."
    },
    {
      name: "Christine C.",
      role: "Senior Program Manager · Uber",
      quote: "Wen-Szu's coaching in structured thinking and communication skills shaped the best practices among the teams. I found these skills extremely helpful when navigating upward communication with senior stakeholders."
    },
    {
      name: "Manasi C.",
      role: "Director, Customer Experience, India & South Asia · Uber",
      quote: "Wen-Szu modeled that great leadership doesn't need noise — it can be empathetic, inclusive, and deeply impactful. His calm, grounded leadership helped me develop clearer structured thinking, better judgment in high-pressure moments, and a more thoughtful, human approach to problem-solving."
    },
    {
      name: "Khushboo G.",
      role: "Program Manager · Uber",
      quote: "Through Uber for Education, you empowered us as leaders across APAC to drive larger, locally relevant outcomes while staying aligned to a shared regional vision. That experience strengthened my confidence as a leader and shaped how I think about enabling teams and leading with intent at scale."
    },
    {
      name: "Sukrut K.",
      role: "Director, S&P, APAC CommOps · Uber",
      quote: "Wen-Szu is an outstanding coach, a phenomenal manager, and a remarkable human — all rolled into one. I learnt complex stakeholder management, crisp corporate communication, rapid decision-making, and experimentation — all while working on amazing projects together."
    },
    {
      name: "Amit Saran",
      role: "Strategy & Programs Lead · Uber",
      quote: "Wen-Szu had an 'always-on' focus on structured thinking and clarity of communication, supported by practical tools and techniques that I continue to use today. His feedback was persistent yet thoughtful and kind, reinforcing his strong belief in clear communication as a core leadership capability."
    },
    {
      name: "Clarisse T.",
      role: "Head of Strategy and Planning · Uber",
      quote: "Wen-Szu taught me so much about structured thinking and clear communication. What I learned from him continues to be a core foundation of how I operate today. I have not met another leader who is as intentional about upskilling at scale."
    }
  ];

  function escapeText(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function testimonialCard(testimonial) {
    const roleParts = testimonial.role.split(/\s*·\s*/);
    const company = roleParts.length > 1 ? roleParts.pop() : "";
    const title = roleParts.join(" · ");
    return `
      <blockquote class="testimonial-card">
        <p>"${escapeText(testimonial.quote)}"</p>
        <footer>
          <strong>${escapeText(testimonial.name)}</strong>
          <span class="testimonial-title">${escapeText(title)}</span>
          <span class="testimonial-company">${escapeText(company)}</span>
        </footer>
      </blockquote>
    `;
  }

  function renderRow(rowId, items) {
    const row = document.getElementById(rowId);
    if (!row) return;
    const cards = items.map(testimonialCard).join("");
    row.innerHTML = `
      <div class="marquee-track">${cards}</div>
      <div class="marquee-track" aria-hidden="true">${cards}</div>
    `;
  }

  const midpoint = Math.ceil(testimonials.length / 2);
  renderRow("testimonialRowOne", testimonials.slice(0, midpoint));
  renderRow("testimonialRowTwo", testimonials.slice(midpoint));
})();

/* Demo election seeding and vote simulation.
   Works through the public backend API, so it behaves identically on the local engine and on
   Supabase.  Demo data always lives in a separate election flagged is_demo — it can never mix
   with the real election (codes, ballots and results are all scoped to their own election). */
(function (S) {
  'use strict';
  const U = S.util;
  const D = (S.demo = {});

  D.SAMPLE = [
    { name: 'President', description: 'Leads the Student Government and represents students to the school leadership.', min: 1, max: 1,
      candidates: [['Candidate Alpha', 'Year 12', 'Together We Lead'], ['Candidate Beta', 'Year 12', 'Every Voice Matters'], ['Candidate Gamma', 'Year 11', 'Building a Better Tomorrow']] },
    { name: 'Vice President', description: 'Supports the President and leads Student Government projects.', min: 1, max: 1,
      candidates: [['Candidate Delta', 'Year 11', 'Ready to Serve'], ['Candidate Epsilon', 'Year 12', 'Listen. Act. Deliver.'], ['Candidate Zeta', 'Year 10', 'Fresh Ideas, Real Change']] },
    { name: 'Secretary', description: 'Keeps records of meetings and communicates decisions to students.', min: 1, max: 1,
      candidates: [['Candidate Eta', 'Year 10', 'Organised for You'], ['Candidate Theta', 'Year 11', 'Clear and Connected']] },
    { name: 'Treasurer', description: 'Manages the Student Government budget openly and responsibly.', min: 1, max: 1,
      candidates: [['Candidate Iota', 'Year 12', 'Every Shilling Counts'], ['Candidate Kappa', 'Year 11', 'Transparent and Trusted'], ['Candidate Lambda', 'Year 10', 'Smart Spending']] },
    { name: 'Class Representatives', description: 'Choose up to two representatives to speak for students in every year group.', min: 1, max: 2,
      candidates: [['Candidate Mu', 'Year 9', 'Your Ideas, My Mission'], ['Candidate Nu', 'Year 10', 'Here for Everyone'], ['Candidate Xi', 'Year 9', 'Small Steps, Big Changes'], ['Candidate Omicron', 'Year 11', 'Stronger Together']] },
  ];

  /* Creates (or returns) the demo election, fully populated and open for testing.
     Returns { election, codes } — codes are shown once to the administrator. */
  D.create = async (api, school) => {
    const pub = await api.getPublic();
    if (pub.demo) return { election: pub.demo, codes: [] };
    const election = await api.createElection({
      is_demo: true,
      name: 'Student Government Elections — DEMO',
      subtitle: 'Practice election · no real votes',
      academic_year: (school && school.academic_year) || String(new Date().getFullYear()),
      description: 'A practice election with sample candidates. Use it to test voting, results and live updates.',
      instructions: 'This is a DEMO ballot. Choose your candidates for each position, review your choices, then submit.',
      confirmation_message: 'This was a demo vote — no real vote was recorded.',
      results_visibility: 'live',
      rotation_seconds: 10,
    });
    for (const p of D.SAMPLE) {
      const pos = await api.savePosition({ election_id: election.id, name: p.name, description: p.description, min_selections: p.min, max_selections: p.max, active: true });
      let n = 0;
      for (const [name, cls, slogan] of p.candidates) {
        n++;
        await api.saveCandidate({
          election_id: election.id, position_id: pos.id, name, class_name: cls, slogan, active: true,
          candidate_code: `DEMO-${pos.name.slice(0, 3).toUpperCase()}-${n}`,
          biography: `${name} is a sample candidate in the demo election.`,
          manifesto: `• A sample manifesto point.\n• Another promise for students.\n• Replace this demo data with your real candidates.`,
        });
      }
    }
    const rows = [];
    ['Demo Class A', 'Demo Class B'].forEach((cls, ci) => {
      for (let i = 1; i <= 30; i++) rows.push({ student_reference: `DEMO-${ci + 1}${String(i).padStart(2, '0')}`, class_name: cls });
    });
    const imported = await api.importVoters(election.id, rows);
    const opened = await api.setStatus(election.id, 'open');
    return { election: opened, codes: imported.created };
  };

  /* Casts `count` random, valid ballots through the normal voting path (begin → submit).
     Only ever used on the demo election. */
  D.simulateVotes = async (api, election, count, onProgress) => {
    if (!election || !election.is_demo) throw new S.ApiError('FORBIDDEN', 'Vote simulation is only available in the demo election.');
    const codes = await api.regenerateCodes(election.id, { allUnused: true, limit: count });
    let done = 0;
    for (const c of codes) {
      const ballot = await api.beginVoting(election.id, c.code);
      const sel = {};
      ballot.positions.forEach((p) => {
        // Weighted randomness so the demo has a visible leader.
        const pool = p.candidates.flatMap((cand, i) => Array(Math.max(1, p.candidates.length - i + (i === 0 ? 2 : 0))).fill(cand.id));
        const pick = new Set();
        const want = Math.max(p.min_selections, Math.min(p.max_selections, 1 + Math.floor(Math.random() * p.max_selections)));
        while (pick.size < Math.min(want, p.candidates.length)) pick.add(pool[Math.floor(Math.random() * pool.length)]);
        sel[p.id] = [...pick];
      });
      await api.submitBallot(ballot.token, sel);
      done++;
      if (onProgress) onProgress(done, codes.length);
      await U.sleep(250);
    }
    return done;
  };
})(window.SGE);

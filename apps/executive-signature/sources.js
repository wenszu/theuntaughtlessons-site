(function(){
  const sources=[
    {id:'donnellan-2006',short:'Donnellan and colleagues (2006)',use:'The 20 questions in the short assessment',url:'https://doi.org/10.1037/1040-3590.18.2.192',citation:'Donnellan, M. B., Oswald, F. L., Baird, B. M., and Lucas, R. E. (2006). The Mini-IPIP scales: Tiny-yet-effective measures of the Big Five factors of personality. Psychological Assessment, 18(2), 192–203.'},
    {id:'johnson-2014',short:'Johnson (2014)',use:'Source pool for the 40 items in the separate full facet report',url:'https://doi.org/10.1016/j.jrp.2014.05.003',citation:'Johnson, J. A. (2014). Measuring thirty facets of the Five Factor Model with a 120-item public domain inventory: Development of the IPIP-NEO-120. Journal of Research in Personality, 51, 78–89.'},
    {id:'kajonius-johnson-2019',short:'Kajonius and Johnson (2019)',use:'Background figures for the IPIP-NEO-120; these figures do not validate the UTL report',url:'https://doi.org/10.5964/ejop.v15i2.1670',citation:'Kajonius, P. J., and Johnson, J. A. (2019). Assessing the structure of the Five Factor Model of personality (IPIP-NEO-120) in the public domain. Europe’s Journal of Psychology, 15(2), 260–275. The published sample included 320,128 people.'},
    {id:'judge-2002',short:'Judge and colleagues (2002)',use:'Background on personality and leadership findings',url:'https://doi.org/10.1037/0021-9010.87.4.765',citation:'Judge, T. A., Bono, J. E., Ilies, R., and Gerhardt, M. W. (2002). Personality and leadership: A qualitative and quantitative review. Journal of Applied Psychology, 87(4), 765–780.'},
    {id:'goldberg-2006',short:'Goldberg and colleagues (2006)',use:'Background on IPIP and public personality measures',url:'https://doi.org/10.1016/j.jrp.2005.08.007',citation:'Goldberg, L. R., Johnson, J. A., Eber, H. W., Hogan, R., Ashton, M. C., Cloninger, C. R., and Gough, H. G. (2006). The International Personality Item Pool and the future of public-domain personality measures. Journal of Research in Personality, 40(1), 84–96.'}
  ];
  const paidItems={
    'Achievement-Striving':['Go straight for the goal.','Work hard.','Do just enough work to get by.','Put little time and effort into my work.'],
    'Self-Discipline':['Start tasks right away.','Carry out my plans.','Waste my time.','Need a push to get started.'],
    'Orderliness':['Like to tidy up.','Do things according to a plan.','Leave my belongings around.','Am not bothered by disorder.'],
    'Intellect':['Like to solve complex problems.','Can handle a lot of information.','Avoid philosophical discussions.','Am not interested in theoretical discussions.'],
    'Anxiety':['Worry about things.','Get stressed out easily.','Am not easily bothered by things.','Am not easily disturbed by events.'],
    'Self-Consciousness':['Am easily intimidated.','Find it difficult to approach others.','Am comfortable in unfamiliar situations.','Am able to stand up for myself.'],
    'Assertiveness':['Take charge.','Try to lead others.','Wait for others to lead the way.','Hold back my opinions.'],
    'Activity Level':['Am always busy.','Can manage many things at the same time.','Like to take it easy.','Like a leisurely lifestyle.'],
    'Cooperation':['Am easy to satisfy.','Hate to seem pushy.','Love a good fight.','Get back at others.'],
    'Altruism':['Love to help others.','Anticipate the needs of others.','Am indifferent to the feelings of others.','Take no time for others.']
  };
  function paidItemsMatch(facets){return Object.entries(paidItems).every(([name,items])=>facets[name]&&items.every((text,i)=>facets[name][2][i]&&facets[name][2][i][0]===text))}
  window.READINESS_SOURCES={version:'1.0.1',sources,paidItems,paidItemsMatch};
})();

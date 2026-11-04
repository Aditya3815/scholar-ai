/**
 * Which of OpenAlex's 252 subfields may produce a Trending chip (docs/design/chatview-and-trending.md, T6). Server side only: the page never imports this file.
 *
 *   allow  a phrase found in this subfield may be shown.
 *   hold   phrases are generated and logged, never shown, until the owner moves the subfield to allow. Health Sciences and every clinical subfield are held (the retracted flag cannot
 *          protect a fresh paper, so the control is the topic), and so are subfields about elections, religion and other contested ground.
 *   never  not looked at at all (no request is made for it).
 *
 * A subfield that is not in the table (OpenAlex adds one) is held, never allowed: `policyOf` answers hold for anything it does not know.
 *
 * The rows between the two marker lines are made by `apps/api/scripts/trending-subfields.mjs` from the live list (https://api.openalex.org/subfields) and then read by the owner once:
 * id, name, field id, field, domain id, domain, policy, and why a subfield is not allowed. Run the script again after OpenAlex changes its taxonomy (`--check` says whether it did): it
 * keeps every decision already in the file and holds what is new. Edit a decision by changing the policy word on its line (and its reason).
 */
export type SubfieldPolicy = "allow" | "hold" | "never";
export type SubfieldInfo = { id: number; name: string; fieldId: number; field: string; domainId: number; domain: string; policy: SubfieldPolicy; why: string };

type Row = readonly [id: number, name: string, fieldId: number, field: string, domainId: number, domain: string, policy: SubfieldPolicy, why: string];

// BEGIN ROWS
const ROWS: readonly Row[] = [
  // Health Sciences / Dentistry
  [3500, "General Dentistry", 35, "Dentistry", 4, "Health Sciences", "hold", "health domain"],
  [3504, "Oral Surgery", 35, "Dentistry", 4, "Health Sciences", "hold", "health domain"],
  [3505, "Orthodontics", 35, "Dentistry", 4, "Health Sciences", "hold", "health domain"],
  [3506, "Periodontics", 35, "Dentistry", 4, "Health Sciences", "hold", "health domain"],
  // Health Sciences / Health Professions
  [3600, "General Health Professions", 36, "Health Professions", 4, "Health Sciences", "hold", "health domain"],
  [3603, "Complementary and Manual Therapy", 36, "Health Professions", 4, "Health Sciences", "hold", "health domain"],
  [3604, "Emergency Medical Services", 36, "Health Professions", 4, "Health Sciences", "hold", "health domain"],
  [3605, "Health Information Management", 36, "Health Professions", 4, "Health Sciences", "hold", "health domain"],
  [3607, "Medical Laboratory Technology", 36, "Health Professions", 4, "Health Sciences", "hold", "health domain"],
  [3608, "Medical Terminology", 36, "Health Professions", 4, "Health Sciences", "hold", "health domain"],
  [3609, "Occupational Therapy", 36, "Health Professions", 4, "Health Sciences", "hold", "health domain"],
  [3611, "Pharmacy", 36, "Health Professions", 4, "Health Sciences", "hold", "health domain"],
  [3612, "Physical Therapy, Sports Therapy and Rehabilitation", 36, "Health Professions", 4, "Health Sciences", "hold", "health domain"],
  [3614, "Radiological and Ultrasound Technology", 36, "Health Professions", 4, "Health Sciences", "hold", "health domain"],
  [3616, "Speech and Hearing", 36, "Health Professions", 4, "Health Sciences", "hold", "health domain"],
  // Health Sciences / Medicine
  [2702, "Anatomy", 27, "Medicine", 4, "Health Sciences", "hold", "health domain"],
  [2703, "Anesthesiology and Pain Medicine", 27, "Medicine", 4, "Health Sciences", "hold", "health domain"],
  [2704, "Biochemistry", 27, "Medicine", 4, "Health Sciences", "hold", "health domain"],
  [2705, "Cardiology and Cardiovascular Medicine", 27, "Medicine", 4, "Health Sciences", "hold", "health domain"],
  [2706, "Critical Care and Intensive Care Medicine", 27, "Medicine", 4, "Health Sciences", "hold", "health domain"],
  [2707, "Complementary and alternative medicine", 27, "Medicine", 4, "Health Sciences", "hold", "health domain"],
  [2708, "Dermatology", 27, "Medicine", 4, "Health Sciences", "hold", "health domain"],
  [2711, "Emergency Medicine", 27, "Medicine", 4, "Health Sciences", "hold", "health domain"],
  [2712, "Endocrinology, Diabetes and Metabolism", 27, "Medicine", 4, "Health Sciences", "hold", "health domain"],
  [2713, "Epidemiology", 27, "Medicine", 4, "Health Sciences", "hold", "health domain"],
  [2714, "Family Practice", 27, "Medicine", 4, "Health Sciences", "hold", "health domain"],
  [2715, "Gastroenterology", 27, "Medicine", 4, "Health Sciences", "hold", "health domain"],
  [2716, "Genetics", 27, "Medicine", 4, "Health Sciences", "hold", "health domain"],
  [2717, "Geriatrics and Gerontology", 27, "Medicine", 4, "Health Sciences", "hold", "health domain"],
  [2718, "Health Informatics", 27, "Medicine", 4, "Health Sciences", "hold", "health domain"],
  [2720, "Hematology", 27, "Medicine", 4, "Health Sciences", "hold", "health domain"],
  [2721, "Hepatology", 27, "Medicine", 4, "Health Sciences", "hold", "health domain"],
  [2723, "Immunology and Allergy", 27, "Medicine", 4, "Health Sciences", "hold", "health domain"],
  [2724, "Internal Medicine", 27, "Medicine", 4, "Health Sciences", "hold", "health domain"],
  [2725, "Infectious Diseases", 27, "Medicine", 4, "Health Sciences", "hold", "health domain"],
  [2726, "Microbiology", 27, "Medicine", 4, "Health Sciences", "hold", "health domain"],
  [2727, "Nephrology", 27, "Medicine", 4, "Health Sciences", "hold", "health domain"],
  [2728, "Neurology", 27, "Medicine", 4, "Health Sciences", "hold", "health domain"],
  [2729, "Obstetrics and Gynecology", 27, "Medicine", 4, "Health Sciences", "hold", "health domain"],
  [2730, "Oncology", 27, "Medicine", 4, "Health Sciences", "hold", "health domain"],
  [2731, "Ophthalmology", 27, "Medicine", 4, "Health Sciences", "hold", "health domain"],
  [2732, "Orthopedics and Sports Medicine", 27, "Medicine", 4, "Health Sciences", "hold", "health domain"],
  [2733, "Otorhinolaryngology", 27, "Medicine", 4, "Health Sciences", "hold", "health domain"],
  [2734, "Pathology and Forensic Medicine", 27, "Medicine", 4, "Health Sciences", "hold", "health domain"],
  [2735, "Pediatrics, Perinatology and Child Health", 27, "Medicine", 4, "Health Sciences", "hold", "health domain"],
  [2736, "Pharmacology", 27, "Medicine", 4, "Health Sciences", "hold", "health domain"],
  [2737, "Physiology", 27, "Medicine", 4, "Health Sciences", "hold", "health domain"],
  [2738, "Psychiatry and Mental health", 27, "Medicine", 4, "Health Sciences", "hold", "health domain"],
  [2739, "Public Health, Environmental and Occupational Health", 27, "Medicine", 4, "Health Sciences", "hold", "health domain"],
  [2740, "Pulmonary and Respiratory Medicine", 27, "Medicine", 4, "Health Sciences", "hold", "health domain"],
  [2741, "Radiology, Nuclear Medicine and Imaging", 27, "Medicine", 4, "Health Sciences", "hold", "health domain"],
  [2742, "Rehabilitation", 27, "Medicine", 4, "Health Sciences", "hold", "health domain"],
  [2743, "Reproductive Medicine", 27, "Medicine", 4, "Health Sciences", "hold", "health domain"],
  [2745, "Rheumatology", 27, "Medicine", 4, "Health Sciences", "hold", "health domain"],
  [2746, "Surgery", 27, "Medicine", 4, "Health Sciences", "hold", "health domain"],
  [2747, "Transplantation", 27, "Medicine", 4, "Health Sciences", "hold", "health domain"],
  [2748, "Urology", 27, "Medicine", 4, "Health Sciences", "hold", "health domain"],
  // Health Sciences / Nursing
  [2910, "Issues, ethics and legal aspects", 29, "Nursing", 4, "Health Sciences", "hold", "health domain"],
  [2911, "Leadership and Management", 29, "Nursing", 4, "Health Sciences", "hold", "health domain"],
  [2916, "Nutrition and Dietetics", 29, "Nursing", 4, "Health Sciences", "hold", "health domain"],
  [2922, "Research and Theory", 29, "Nursing", 4, "Health Sciences", "hold", "health domain"],
  // Health Sciences / Veterinary
  [3402, "Equine", 34, "Veterinary", 4, "Health Sciences", "hold", "health domain"],
  [3404, "Small Animals", 34, "Veterinary", 4, "Health Sciences", "hold", "health domain"],
  // Life Sciences / Agricultural and Biological Sciences
  [1100, "General Agricultural and Biological Sciences", 11, "Agricultural and Biological Sciences", 1, "Life Sciences", "never", "catch-all"],
  [1102, "Agronomy and Crop Science", 11, "Agricultural and Biological Sciences", 1, "Life Sciences", "allow", ""],
  [1103, "Animal Science and Zoology", 11, "Agricultural and Biological Sciences", 1, "Life Sciences", "allow", ""],
  [1104, "Aquatic Science", 11, "Agricultural and Biological Sciences", 1, "Life Sciences", "allow", ""],
  [1105, "Ecology, Evolution, Behavior and Systematics", 11, "Agricultural and Biological Sciences", 1, "Life Sciences", "allow", ""],
  [1106, "Food Science", 11, "Agricultural and Biological Sciences", 1, "Life Sciences", "allow", ""],
  [1107, "Forestry", 11, "Agricultural and Biological Sciences", 1, "Life Sciences", "allow", ""],
  [1108, "Horticulture", 11, "Agricultural and Biological Sciences", 1, "Life Sciences", "allow", ""],
  [1109, "Insect Science", 11, "Agricultural and Biological Sciences", 1, "Life Sciences", "allow", ""],
  [1110, "Plant Science", 11, "Agricultural and Biological Sciences", 1, "Life Sciences", "allow", ""],
  [1111, "Soil Science", 11, "Agricultural and Biological Sciences", 1, "Life Sciences", "allow", ""],
  // Life Sciences / Biochemistry, Genetics and Molecular Biology
  [1302, "Aging", 13, "Biochemistry, Genetics and Molecular Biology", 1, "Life Sciences", "hold", "health claims"],
  [1303, "Biochemistry", 13, "Biochemistry, Genetics and Molecular Biology", 1, "Life Sciences", "allow", ""],
  [1304, "Biophysics", 13, "Biochemistry, Genetics and Molecular Biology", 1, "Life Sciences", "allow", ""],
  [1305, "Biotechnology", 13, "Biochemistry, Genetics and Molecular Biology", 1, "Life Sciences", "allow", ""],
  [1306, "Cancer Research", 13, "Biochemistry, Genetics and Molecular Biology", 1, "Life Sciences", "hold", "clinical"],
  [1307, "Cell Biology", 13, "Biochemistry, Genetics and Molecular Biology", 1, "Life Sciences", "allow", ""],
  [1308, "Clinical Biochemistry", 13, "Biochemistry, Genetics and Molecular Biology", 1, "Life Sciences", "hold", "clinical"],
  [1309, "Developmental Biology", 13, "Biochemistry, Genetics and Molecular Biology", 1, "Life Sciences", "allow", ""],
  [1310, "Endocrinology", 13, "Biochemistry, Genetics and Molecular Biology", 1, "Life Sciences", "hold", "clinical"],
  [1311, "Genetics", 13, "Biochemistry, Genetics and Molecular Biology", 1, "Life Sciences", "allow", ""],
  [1312, "Molecular Biology", 13, "Biochemistry, Genetics and Molecular Biology", 1, "Life Sciences", "allow", ""],
  [1313, "Molecular Medicine", 13, "Biochemistry, Genetics and Molecular Biology", 1, "Life Sciences", "hold", "clinical"],
  [1314, "Physiology", 13, "Biochemistry, Genetics and Molecular Biology", 1, "Life Sciences", "allow", ""],
  [1315, "Structural Biology", 13, "Biochemistry, Genetics and Molecular Biology", 1, "Life Sciences", "allow", ""],
  // Life Sciences / Immunology and Microbiology
  [2402, "Applied Microbiology and Biotechnology", 24, "Immunology and Microbiology", 1, "Life Sciences", "allow", ""],
  [2403, "Immunology", 24, "Immunology and Microbiology", 1, "Life Sciences", "hold", "clinical"],
  [2404, "Microbiology", 24, "Immunology and Microbiology", 1, "Life Sciences", "hold", "infectious disease"],
  [2405, "Parasitology", 24, "Immunology and Microbiology", 1, "Life Sciences", "hold", "infectious disease"],
  [2406, "Virology", 24, "Immunology and Microbiology", 1, "Life Sciences", "hold", "infectious disease"],
  // Life Sciences / Neuroscience
  [2802, "Behavioral Neuroscience", 28, "Neuroscience", 1, "Life Sciences", "allow", ""],
  [2803, "Biological Psychiatry", 28, "Neuroscience", 1, "Life Sciences", "hold", "clinical"],
  [2804, "Cellular and Molecular Neuroscience", 28, "Neuroscience", 1, "Life Sciences", "allow", ""],
  [2805, "Cognitive Neuroscience", 28, "Neuroscience", 1, "Life Sciences", "allow", ""],
  [2806, "Developmental Neuroscience", 28, "Neuroscience", 1, "Life Sciences", "allow", ""],
  [2807, "Endocrine and Autonomic Systems", 28, "Neuroscience", 1, "Life Sciences", "hold", "clinical"],
  [2808, "Neurology", 28, "Neuroscience", 1, "Life Sciences", "hold", "clinical"],
  [2809, "Sensory Systems", 28, "Neuroscience", 1, "Life Sciences", "allow", ""],
  // Life Sciences / Pharmacology, Toxicology and Pharmaceutics
  [3002, "Drug Discovery", 30, "Pharmacology, Toxicology and Pharmaceutics", 1, "Life Sciences", "hold", "drugs"],
  [3003, "Pharmaceutical Science", 30, "Pharmacology, Toxicology and Pharmaceutics", 1, "Life Sciences", "hold", "drugs"],
  [3004, "Pharmacology", 30, "Pharmacology, Toxicology and Pharmaceutics", 1, "Life Sciences", "hold", "drugs"],
  [3005, "Toxicology", 30, "Pharmacology, Toxicology and Pharmaceutics", 1, "Life Sciences", "hold", "drugs"],
  // Physical Sciences / Chemical Engineering
  [1502, "Bioengineering", 15, "Chemical Engineering", 3, "Physical Sciences", "allow", ""],
  [1503, "Catalysis", 15, "Chemical Engineering", 3, "Physical Sciences", "allow", ""],
  [1504, "Chemical Health and Safety", 15, "Chemical Engineering", 3, "Physical Sciences", "hold", "health"],
  [1506, "Filtration and Separation", 15, "Chemical Engineering", 3, "Physical Sciences", "allow", ""],
  [1507, "Fluid Flow and Transfer Processes", 15, "Chemical Engineering", 3, "Physical Sciences", "allow", ""],
  [1508, "Process Chemistry and Technology", 15, "Chemical Engineering", 3, "Physical Sciences", "allow", ""],
  // Physical Sciences / Chemistry
  [1602, "Analytical Chemistry", 16, "Chemistry", 3, "Physical Sciences", "allow", ""],
  [1603, "Electrochemistry", 16, "Chemistry", 3, "Physical Sciences", "allow", ""],
  [1604, "Inorganic Chemistry", 16, "Chemistry", 3, "Physical Sciences", "allow", ""],
  [1605, "Organic Chemistry", 16, "Chemistry", 3, "Physical Sciences", "allow", ""],
  [1606, "Physical and Theoretical Chemistry", 16, "Chemistry", 3, "Physical Sciences", "allow", ""],
  [1607, "Spectroscopy", 16, "Chemistry", 3, "Physical Sciences", "allow", ""],
  // Physical Sciences / Computer Science
  [1702, "Artificial Intelligence", 17, "Computer Science", 3, "Physical Sciences", "allow", ""],
  [1703, "Computational Theory and Mathematics", 17, "Computer Science", 3, "Physical Sciences", "allow", ""],
  [1704, "Computer Graphics and Computer-Aided Design", 17, "Computer Science", 3, "Physical Sciences", "allow", ""],
  [1705, "Computer Networks and Communications", 17, "Computer Science", 3, "Physical Sciences", "allow", ""],
  [1706, "Computer Science Applications", 17, "Computer Science", 3, "Physical Sciences", "allow", ""],
  [1707, "Computer Vision and Pattern Recognition", 17, "Computer Science", 3, "Physical Sciences", "allow", ""],
  [1708, "Hardware and Architecture", 17, "Computer Science", 3, "Physical Sciences", "allow", ""],
  [1709, "Human-Computer Interaction", 17, "Computer Science", 3, "Physical Sciences", "allow", ""],
  [1710, "Information Systems", 17, "Computer Science", 3, "Physical Sciences", "allow", ""],
  [1711, "Signal Processing", 17, "Computer Science", 3, "Physical Sciences", "allow", ""],
  [1712, "Software", 17, "Computer Science", 3, "Physical Sciences", "allow", ""],
  // Physical Sciences / Earth and Planetary Sciences
  [1902, "Atmospheric Science", 19, "Earth and Planetary Sciences", 3, "Physical Sciences", "allow", ""],
  [1904, "Earth-Surface Processes", 19, "Earth and Planetary Sciences", 3, "Physical Sciences", "allow", ""],
  [1906, "Geochemistry and Petrology", 19, "Earth and Planetary Sciences", 3, "Physical Sciences", "allow", ""],
  [1907, "Geology", 19, "Earth and Planetary Sciences", 3, "Physical Sciences", "allow", ""],
  [1908, "Geophysics", 19, "Earth and Planetary Sciences", 3, "Physical Sciences", "allow", ""],
  [1910, "Oceanography", 19, "Earth and Planetary Sciences", 3, "Physical Sciences", "allow", ""],
  [1911, "Paleontology", 19, "Earth and Planetary Sciences", 3, "Physical Sciences", "allow", ""],
  [1912, "Space and Planetary Science", 19, "Earth and Planetary Sciences", 3, "Physical Sciences", "allow", ""],
  // Physical Sciences / Energy
  [2100, "General Energy", 21, "Energy", 3, "Physical Sciences", "never", "catch-all"],
  [2102, "Energy Engineering and Power Technology", 21, "Energy", 3, "Physical Sciences", "allow", ""],
  [2103, "Fuel Technology", 21, "Energy", 3, "Physical Sciences", "allow", ""],
  [2104, "Nuclear Energy and Engineering", 21, "Energy", 3, "Physical Sciences", "allow", ""],
  [2105, "Renewable Energy, Sustainability and the Environment", 21, "Energy", 3, "Physical Sciences", "allow", ""],
  // Physical Sciences / Engineering
  [2200, "General Engineering", 22, "Engineering", 3, "Physical Sciences", "never", "catch-all"],
  [2202, "Aerospace Engineering", 22, "Engineering", 3, "Physical Sciences", "allow", ""],
  [2203, "Automotive Engineering", 22, "Engineering", 3, "Physical Sciences", "allow", ""],
  [2204, "Biomedical Engineering", 22, "Engineering", 3, "Physical Sciences", "hold", "clinical"],
  [2205, "Civil and Structural Engineering", 22, "Engineering", 3, "Physical Sciences", "allow", ""],
  [2206, "Computational Mechanics", 22, "Engineering", 3, "Physical Sciences", "allow", ""],
  [2207, "Control and Systems Engineering", 22, "Engineering", 3, "Physical Sciences", "allow", ""],
  [2208, "Electrical and Electronic Engineering", 22, "Engineering", 3, "Physical Sciences", "allow", ""],
  [2209, "Industrial and Manufacturing Engineering", 22, "Engineering", 3, "Physical Sciences", "allow", ""],
  [2210, "Mechanical Engineering", 22, "Engineering", 3, "Physical Sciences", "allow", ""],
  [2211, "Mechanics of Materials", 22, "Engineering", 3, "Physical Sciences", "allow", ""],
  [2212, "Ocean Engineering", 22, "Engineering", 3, "Physical Sciences", "allow", ""],
  [2213, "Safety, Risk, Reliability and Quality", 22, "Engineering", 3, "Physical Sciences", "allow", ""],
  [2214, "Media Technology", 22, "Engineering", 3, "Physical Sciences", "allow", ""],
  [2215, "Building and Construction", 22, "Engineering", 3, "Physical Sciences", "allow", ""],
  [2216, "Architecture", 22, "Engineering", 3, "Physical Sciences", "allow", ""],
  // Physical Sciences / Environmental Science
  [2302, "Ecological Modeling", 23, "Environmental Science", 3, "Physical Sciences", "allow", ""],
  [2303, "Ecology", 23, "Environmental Science", 3, "Physical Sciences", "allow", ""],
  [2304, "Environmental Chemistry", 23, "Environmental Science", 3, "Physical Sciences", "allow", ""],
  [2305, "Environmental Engineering", 23, "Environmental Science", 3, "Physical Sciences", "allow", ""],
  [2306, "Global and Planetary Change", 23, "Environmental Science", 3, "Physical Sciences", "allow", ""],
  [2307, "Health, Toxicology and Mutagenesis", 23, "Environmental Science", 3, "Physical Sciences", "hold", "health"],
  [2308, "Management, Monitoring, Policy and Law", 23, "Environmental Science", 3, "Physical Sciences", "allow", ""],
  [2309, "Nature and Landscape Conservation", 23, "Environmental Science", 3, "Physical Sciences", "allow", ""],
  [2310, "Pollution", 23, "Environmental Science", 3, "Physical Sciences", "allow", ""],
  [2311, "Waste Management and Disposal", 23, "Environmental Science", 3, "Physical Sciences", "allow", ""],
  [2312, "Water Science and Technology", 23, "Environmental Science", 3, "Physical Sciences", "allow", ""],
  // Physical Sciences / Materials Science
  [2500, "General Materials Science", 25, "Materials Science", 3, "Physical Sciences", "never", "catch-all"],
  [2502, "Biomaterials", 25, "Materials Science", 3, "Physical Sciences", "allow", ""],
  [2503, "Ceramics and Composites", 25, "Materials Science", 3, "Physical Sciences", "allow", ""],
  [2504, "Electronic, Optical and Magnetic Materials", 25, "Materials Science", 3, "Physical Sciences", "allow", ""],
  [2505, "Materials Chemistry", 25, "Materials Science", 3, "Physical Sciences", "allow", ""],
  [2506, "Metals and Alloys", 25, "Materials Science", 3, "Physical Sciences", "allow", ""],
  [2507, "Polymers and Plastics", 25, "Materials Science", 3, "Physical Sciences", "allow", ""],
  [2508, "Surfaces, Coatings and Films", 25, "Materials Science", 3, "Physical Sciences", "allow", ""],
  // Physical Sciences / Mathematics
  [2602, "Algebra and Number Theory", 26, "Mathematics", 3, "Physical Sciences", "allow", ""],
  [2604, "Applied Mathematics", 26, "Mathematics", 3, "Physical Sciences", "allow", ""],
  [2605, "Computational Mathematics", 26, "Mathematics", 3, "Physical Sciences", "allow", ""],
  [2607, "Discrete Mathematics and Combinatorics", 26, "Mathematics", 3, "Physical Sciences", "allow", ""],
  [2608, "Geometry and Topology", 26, "Mathematics", 3, "Physical Sciences", "allow", ""],
  [2610, "Mathematical Physics", 26, "Mathematics", 3, "Physical Sciences", "allow", ""],
  [2611, "Modeling and Simulation", 26, "Mathematics", 3, "Physical Sciences", "allow", ""],
  [2612, "Numerical Analysis", 26, "Mathematics", 3, "Physical Sciences", "allow", ""],
  [2613, "Statistics and Probability", 26, "Mathematics", 3, "Physical Sciences", "allow", ""],
  [2614, "Theoretical Computer Science", 26, "Mathematics", 3, "Physical Sciences", "allow", ""],
  // Physical Sciences / Physics and Astronomy
  [3102, "Acoustics and Ultrasonics", 31, "Physics and Astronomy", 3, "Physical Sciences", "allow", ""],
  [3103, "Astronomy and Astrophysics", 31, "Physics and Astronomy", 3, "Physical Sciences", "allow", ""],
  [3104, "Condensed Matter Physics", 31, "Physics and Astronomy", 3, "Physical Sciences", "allow", ""],
  [3105, "Instrumentation", 31, "Physics and Astronomy", 3, "Physical Sciences", "allow", ""],
  [3106, "Nuclear and High Energy Physics", 31, "Physics and Astronomy", 3, "Physical Sciences", "allow", ""],
  [3107, "Atomic and Molecular Physics, and Optics", 31, "Physics and Astronomy", 3, "Physical Sciences", "allow", ""],
  [3108, "Radiation", 31, "Physics and Astronomy", 3, "Physical Sciences", "allow", ""],
  [3109, "Statistical and Nonlinear Physics", 31, "Physics and Astronomy", 3, "Physical Sciences", "allow", ""],
  // Social Sciences / Arts and Humanities
  [1200, "General Arts and Humanities", 12, "Arts and Humanities", 2, "Social Sciences", "never", "catch-all"],
  [1202, "History", 12, "Arts and Humanities", 2, "Social Sciences", "hold", "named people and events"],
  [1203, "Language and Linguistics", 12, "Arts and Humanities", 2, "Social Sciences", "allow", ""],
  [1204, "Archeology", 12, "Arts and Humanities", 2, "Social Sciences", "allow", ""],
  [1205, "Classics", 12, "Arts and Humanities", 2, "Social Sciences", "allow", ""],
  [1206, "Conservation", 12, "Arts and Humanities", 2, "Social Sciences", "allow", ""],
  [1207, "History and Philosophy of Science", 12, "Arts and Humanities", 2, "Social Sciences", "allow", ""],
  [1208, "Literature and Literary Theory", 12, "Arts and Humanities", 2, "Social Sciences", "allow", ""],
  [1209, "Museology", 12, "Arts and Humanities", 2, "Social Sciences", "allow", ""],
  [1210, "Music", 12, "Arts and Humanities", 2, "Social Sciences", "allow", ""],
  [1211, "Philosophy", 12, "Arts and Humanities", 2, "Social Sciences", "allow", ""],
  [1212, "Religious studies", 12, "Arts and Humanities", 2, "Social Sciences", "hold", "contested ground"],
  [1213, "Visual Arts and Performing Arts", 12, "Arts and Humanities", 2, "Social Sciences", "allow", ""],
  // Social Sciences / Business, Management and Accounting
  [1402, "Accounting", 14, "Business, Management and Accounting", 2, "Social Sciences", "allow", ""],
  [1403, "Business and International Management", 14, "Business, Management and Accounting", 2, "Social Sciences", "allow", ""],
  [1404, "Management Information Systems", 14, "Business, Management and Accounting", 2, "Social Sciences", "allow", ""],
  [1405, "Management of Technology and Innovation", 14, "Business, Management and Accounting", 2, "Social Sciences", "allow", ""],
  [1406, "Marketing", 14, "Business, Management and Accounting", 2, "Social Sciences", "allow", ""],
  [1407, "Organizational Behavior and Human Resource Management", 14, "Business, Management and Accounting", 2, "Social Sciences", "allow", ""],
  [1408, "Strategy and Management", 14, "Business, Management and Accounting", 2, "Social Sciences", "allow", ""],
  [1409, "Tourism, Leisure and Hospitality Management", 14, "Business, Management and Accounting", 2, "Social Sciences", "allow", ""],
  [1410, "Industrial relations", 14, "Business, Management and Accounting", 2, "Social Sciences", "allow", ""],
  // Social Sciences / Decision Sciences
  [1800, "General Decision Sciences", 18, "Decision Sciences", 2, "Social Sciences", "never", "catch-all"],
  [1802, "Information Systems and Management", 18, "Decision Sciences", 2, "Social Sciences", "allow", ""],
  [1803, "Management Science and Operations Research", 18, "Decision Sciences", 2, "Social Sciences", "allow", ""],
  [1804, "Statistics, Probability and Uncertainty", 18, "Decision Sciences", 2, "Social Sciences", "allow", ""],
  // Social Sciences / Economics, Econometrics and Finance
  [2000, "General Economics, Econometrics and Finance", 20, "Economics, Econometrics and Finance", 2, "Social Sciences", "never", "catch-all"],
  [2002, "Economics and Econometrics", 20, "Economics, Econometrics and Finance", 2, "Social Sciences", "allow", ""],
  [2003, "Finance", 20, "Economics, Econometrics and Finance", 2, "Social Sciences", "allow", ""],
  // Social Sciences / Psychology
  [3200, "General Psychology", 32, "Psychology", 2, "Social Sciences", "never", "catch-all"],
  [3202, "Applied Psychology", 32, "Psychology", 2, "Social Sciences", "allow", ""],
  [3203, "Clinical Psychology", 32, "Psychology", 2, "Social Sciences", "hold", "clinical"],
  [3204, "Developmental and Educational Psychology", 32, "Psychology", 2, "Social Sciences", "allow", ""],
  [3205, "Experimental and Cognitive Psychology", 32, "Psychology", 2, "Social Sciences", "allow", ""],
  [3206, "Neuropsychology and Physiological Psychology", 32, "Psychology", 2, "Social Sciences", "hold", "clinical"],
  [3207, "Social Psychology", 32, "Psychology", 2, "Social Sciences", "allow", ""],
  // Social Sciences / Social Sciences
  [3300, "General Social Sciences", 33, "Social Sciences", 2, "Social Sciences", "never", "catch-all"],
  [3302, "Archeology", 33, "Social Sciences", 2, "Social Sciences", "allow", ""],
  [3303, "Development", 33, "Social Sciences", 2, "Social Sciences", "allow", ""],
  [3304, "Education", 33, "Social Sciences", 2, "Social Sciences", "allow", ""],
  [3305, "Geography, Planning and Development", 33, "Social Sciences", 2, "Social Sciences", "allow", ""],
  [3306, "Health", 33, "Social Sciences", 2, "Social Sciences", "hold", "health"],
  [3307, "Human Factors and Ergonomics", 33, "Social Sciences", 2, "Social Sciences", "allow", ""],
  [3308, "Law", 33, "Social Sciences", 2, "Social Sciences", "allow", ""],
  [3309, "Library and Information Sciences", 33, "Social Sciences", 2, "Social Sciences", "allow", ""],
  [3310, "Linguistics and Language", 33, "Social Sciences", 2, "Social Sciences", "allow", ""],
  [3311, "Safety Research", 33, "Social Sciences", 2, "Social Sciences", "allow", ""],
  [3312, "Sociology and Political Science", 33, "Social Sciences", 2, "Social Sciences", "hold", "elections and politics"],
  [3313, "Transportation", 33, "Social Sciences", 2, "Social Sciences", "allow", ""],
  [3314, "Anthropology", 33, "Social Sciences", 2, "Social Sciences", "allow", ""],
  [3315, "Communication", 33, "Social Sciences", 2, "Social Sciences", "allow", ""],
  [3316, "Cultural Studies", 33, "Social Sciences", 2, "Social Sciences", "allow", ""],
  [3317, "Demography", 33, "Social Sciences", 2, "Social Sciences", "allow", ""],
  [3318, "Gender Studies", 33, "Social Sciences", 2, "Social Sciences", "hold", "contested ground"],
  [3319, "Life-span and Life-course Studies", 33, "Social Sciences", 2, "Social Sciences", "allow", ""],
  [3320, "Political Science and International Relations", 33, "Social Sciences", 2, "Social Sciences", "hold", "elections and politics"],
  [3321, "Public Administration", 33, "Social Sciences", 2, "Social Sciences", "allow", ""],
  [3322, "Urban Studies", 33, "Social Sciences", 2, "Social Sciences", "allow", ""],
];
// END ROWS

export const SUBFIELDS: readonly SubfieldInfo[] = ROWS.map(([id, name, fieldId, field, domainId, domain, policy, why]) => ({ id, name, fieldId, field, domainId, domain, policy, why }));
const BY_ID: ReadonlyMap<number, SubfieldInfo> = new Map(SUBFIELDS.map((s) => [s.id, s]));

/** The subfields the job asks OpenAlex about: every one that is not "never" (held ones are looked at too, so the owner can read what they would have shown). */
export const QUERYABLE_SUBFIELDS: readonly number[] = SUBFIELDS.filter((s) => s.policy !== "never").map((s) => s.id);

/** A subfield id as OpenAlex writes it: 1702, "1702" or "https://openalex.org/subfields/1702". Null for anything else. */
export function parseSubfieldId(raw: unknown): number | null {
  const m = typeof raw === "string" ? /^(?:(?:https?:\/\/)?openalex\.org\/subfields\/)?(\d{1,5})$/.exec(raw.trim()) : null;
  const n = typeof raw === "number" ? raw : m ? Number(m[1]) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 99999 ? n : null;
}

export function subfieldInfo(raw: unknown): SubfieldInfo | undefined {
  const id = parseSubfieldId(raw);
  return id === null ? undefined : BY_ID.get(id);
}

/** What may be done with phrases found in this subfield. An unknown subfield is held. */
export function policyOf(raw: unknown): SubfieldPolicy {
  return subfieldInfo(raw)?.policy ?? "hold";
}

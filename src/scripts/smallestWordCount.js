const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

const ECFR_API_BASE = 'https://www.ecfr.gov/api';
const DATA_DIR = path.join(__dirname, '../../data/word-counts-small');
const PROGRESS_FILE = path.join(DATA_DIR, 'progress.json');

// Store overall progress
let progress = {
  totalAgencies: 0,
  completedAgencies: 0,
  currentAgency: '',
  agenciesProgress: {},
  startTime: null,
  lastSaveTime: null,
  status: 'initializing'
};

async function init() {
  // Create data directory if it doesn't exist
  await fs.mkdir(DATA_DIR, { recursive: true });
  
  // Try to load existing progress
  try {
    const savedProgress = await fs.readFile(PROGRESS_FILE, 'utf8');
    progress = JSON.parse(savedProgress);
    console.log('Resuming previous run...');
  } catch (err) {
    // No progress file yet, starting fresh
    progress.startTime = new Date().toISOString();
    await saveProgress();
  }
}

async function saveProgress() {
  progress.lastSaveTime = new Date().toISOString();
  await fs.writeFile(PROGRESS_FILE, JSON.stringify(progress, null, 2));

  // Generate status HTML file for browser viewing
  const statusHtml = generateStatusHtml();
  await fs.writeFile(path.join(DATA_DIR, 'status.html'), statusHtml);
}

function generateStatusHtml() {
  const percentComplete = progress.totalAgencies > 0 
    ? Math.round((progress.completedAgencies / progress.totalAgencies) * 100) 
    : 0;
  
  const elapsedTime = progress.startTime 
    ? Math.round((new Date() - new Date(progress.startTime)) / 1000 / 60) 
    : 0;
  
  const agencyDetails = Object.entries(progress.agenciesProgress).map(([name, data]) => {
    const agencyPercent = data.totalParts > 0 
      ? Math.round((data.completedParts / data.totalParts) * 100) 
      : 0;
    
    return `
      <div class="agency">
        <h3>${name}</h3>
        <div class="progress-bar-container">
          <div class="progress-bar" style="width: ${agencyPercent}%;">${agencyPercent}%</div>
        </div>
        <p>Words counted: ${data.wordCount?.toLocaleString() || 0}</p>
        <p>Parts processed: ${data.completedParts} / ${data.totalParts}</p>
      </div>
    `;
  }).join('');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Small Agencies Word Count Progress</title>
      <meta http-equiv="refresh" content="5">
      <style>
        body {
          font-family: Arial, sans-serif;
          max-width: 800px;
          margin: 0 auto;
          padding: 20px;
        }
        h1, h2, h3 {
          margin-top: 20px;
        }
        .progress-bar-container {
          width: 100%;
          background-color: #f0f0f0;
          border-radius: 4px;
          margin: 10px 0;
        }
        .progress-bar {
          height: 24px;
          background-color: #4CAF50;
          border-radius: 4px;
          text-align: center;
          line-height: 24px;
          color: white;
        }
        .agency {
          margin: 20px 0;
          padding: 10px;
          border: 1px solid #ddd;
          border-radius: 4px;
        }
        .status {
          padding: 10px;
          border-radius: 4px;
          margin-bottom: 20px;
          font-weight: bold;
        }
        .running {
          background-color: #e7f3ff;
          color: #0066cc;
        }
        .completed {
          background-color: #e6ffe6;
          color: #006600;
        }
        .error {
          background-color: #ffebe6;
          color: #cc0000;
        }
      </style>
    </head>
    <body>
      <h1>Small Agencies Word Count Progress</h1>
      
      <div class="status ${progress.status === 'completed' ? 'completed' : progress.status === 'error' ? 'error' : 'running'}">
        Status: ${progress.status.charAt(0).toUpperCase() + progress.status.slice(1)}
      </div>
      
      <div class="progress-bar-container">
        <div class="progress-bar" style="width: ${percentComplete}%;">${percentComplete}% Complete</div>
      </div>
      
      <p>Currently processing: ${progress.currentAgency || 'Not started'}</p>
      <p>Elapsed time: ${elapsedTime} minutes</p>
      <p>Agencies completed: ${progress.completedAgencies} / ${progress.totalAgencies}</p>
      
      <h2>Agency Details</h2>
      ${agencyDetails}
      
      <script>
        // This will force the page to refresh every 5 seconds
        setTimeout(() => { window.location.reload(); }, 5000);
      </script>
    </body>
    </html>
  `;
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getWithRetry(endpoint, options = {}, maxRetries = 5) {
  let retries = 0;
  while (retries < maxRetries) {
    try {
      const response = await axios.get(`${ECFR_API_BASE}/${endpoint}`, options);
      return response.data;
    } catch (err) {
      if (err.response?.status === 429) {
        // Rate limited - exponential backoff
        const delay = Math.pow(2, retries) * 1000 + Math.random() * 1000;
        console.log(`Rate limited, waiting ${delay}ms before retry`);
        await sleep(delay);
        retries++;
      } else if (err.response?.status === 404) {
        // Not found - can't retry
        console.log(`Resource not found: ${endpoint}`);
        return null;
      } else {
        // Other error - wait and retry
        console.log(`Error fetching ${endpoint}: ${err.message}`);
        await sleep(1000);
        retries++;
      }
    }
  }
  console.log(`Max retries exceeded for ${endpoint}`);
  return null;
}

async function countWordsInXml(xml) {
  if (!xml) return 0;
  const textContent = xml.replace(/<[^>]*>/g, ' ');
  return textContent.split(/\s+/).filter(word => word.length > 0).length;
}

async function processAgency(agency) {
  console.log(`Processing agency: ${agency.name}`);
  progress.currentAgency = agency.name;
  
  // Initialize agency progress
  if (!progress.agenciesProgress[agency.name]) {
    progress.agenciesProgress[agency.name] = {
      completedParts: 0,
      totalParts: 0,
      wordCount: 0,
      titles: {},
      slug: agency.slug
    };
  }
  
  const agencyProgress = progress.agenciesProgress[agency.name];
  
  // Skip if already completed
  if (agencyProgress.completed) {
    console.log(`Agency ${agency.name} already completed, skipping`);
    return;
  }
  
  // Process each CFR reference
  if (agency.cfr_references && agency.cfr_references.length > 0) {
    for (const ref of agency.cfr_references) {
      if (!ref.title) continue;
      
      // Skip if this title was already processed
      if (agencyProgress.titles[ref.title]?.completed) {
        console.log(`Title ${ref.title} already processed for ${agency.name}, skipping`);
        continue;
      }
      
      // Initialize title tracking
      if (!agencyProgress.titles[ref.title]) {
        agencyProgress.titles[ref.title] = {
          parts: {},
          completed: false
        };
      }
      
      const titleProgress = agencyProgress.titles[ref.title];
      
      // Get structure for this title
      console.log(`Getting structure for title ${ref.title}`);
      const structureResponse = await getWithRetry(`versioner/v1/structure/2023-01-01/title-${ref.title}.json`);
      
      if (!structureResponse || !structureResponse.children || !structureResponse.children[0] || !structureResponse.children[0].children) {
        console.log(`No parts found for title ${ref.title}`);
        titleProgress.completed = true;
        await saveProgress();
        continue;
      }
      
      const parts = structureResponse.children[0].children;
      
      // Count total parts for progress calculation
      const newParts = parts.filter(part => !titleProgress.parts[part.identifier]);
      agencyProgress.totalParts += newParts.length;
      progress.agenciesProgress[agency.name] = agencyProgress;
      await saveProgress();
      
      // Process each part
      for (const part of parts) {
        // Skip if already processed
        if (titleProgress.parts[part.identifier]?.completed) {
          console.log(`Part ${part.identifier} already processed for title ${ref.title}, skipping`);
          continue;
        }
        
        console.log(`Processing title ${ref.title}, part ${part.identifier}`);
        
        // Initialize part tracking
        if (!titleProgress.parts[part.identifier]) {
          titleProgress.parts[part.identifier] = {
            completed: false,
            wordCount: 0
          };
        }
        
        // Get XML content
        try {
          const partXml = await getWithRetry(
            `versioner/v1/full/2023-01-01/title-${ref.title}.xml?part=${part.identifier}`,
            { responseType: 'text' }
          );
          
          if (partXml) {
            // Count words
            const wordCount = await countWordsInXml(partXml);
            titleProgress.parts[part.identifier].wordCount = wordCount;
            agencyProgress.wordCount += wordCount;
            
            console.log(`Title ${ref.title}, part ${part.identifier}: ${wordCount} words`);
          }
        } catch (err) {
          console.error(`Error processing XML for title ${ref.title}, part ${part.identifier}:`, err.message);
        }
        
        // Mark part as completed
        titleProgress.parts[part.identifier].completed = true;
        agencyProgress.completedParts++;
        
        // Save progress after each part
        await saveProgress();
        
        // Wait to avoid rate limiting
        await sleep(2000);
      }
      
      // Mark title as completed
      titleProgress.completed = true;
      await saveProgress();
    }
  }
  
  // Mark agency as completed
  agencyProgress.completed = true;
  progress.completedAgencies++;
  await saveProgress();
}

async function runSmallestWordCount(topN = 5) {
  try {
    await init();
    progress.status = 'running';
    await saveProgress();
    
    // Get all agencies if not already loaded
    if (!progress.agencies) {
      console.log('Getting all agencies...');
      const response = await axios.get(`${ECFR_API_BASE}/admin/v1/agencies.json`);
      
      // First filter out agencies with no CFR references
      let agencies = response.data.agencies.filter(a => 
        a.cfr_references && a.cfr_references.length > 0
      );
      
      // Sort agencies by size (number of CFR references) - SMALLEST FIRST
      agencies = agencies.sort((a, b) => {
        const aRefs = a.cfr_references?.length || 0;
        const bRefs = b.cfr_references?.length || 0;
        return aRefs - bRefs; // Ascending order (smallest first)
      });
      
      // Take only top N smallest agencies
      progress.agencies = agencies.slice(0, topN);
      progress.totalAgencies = progress.agencies.length;
      await saveProgress();
    }
    
    // Process each agency
    for (const agency of progress.agencies) {
      await processAgency(agency);
    }
    
    // Track shared titles between agencies
    const titleUsage = new Map(); // Maps title numbers to arrays of agency names
    
    // Build map of which titles are used by which agencies
    for (const [agencyName, agencyData] of Object.entries(progress.agenciesProgress)) {
      const titles = Object.keys(agencyData.titles);
      
      for (const title of titles) {
        if (!titleUsage.has(title)) {
          titleUsage.set(title, []);
        }
        titleUsage.get(title).push(agencyName);
      }
    }
    
    // Find shared titles (used by more than one agency)
    const sharedTitles = new Map();
    for (const [title, agencies] of titleUsage.entries()) {
      if (agencies.length > 1) {
        sharedTitles.set(title, agencies);
      }
    }
    
    // Save final report with shared regulation notes
    const finalReport = Object.entries(progress.agenciesProgress).map(([name, data]) => {
      // Get titles this agency shares with others
      const agencyTitles = Object.keys(data.titles);
      const sharedWithOthers = agencyTitles
        .filter(title => titleUsage.get(title).length > 1)
        .map(title => {
          const sharingAgencies = titleUsage.get(title).filter(a => a !== name);
          return { title, sharingAgencies };
        });
      
      const sharedRegulationsNote = sharedWithOthers.length > 0 
        ? `Shares regulations with other agencies: ${sharedWithOthers.map(s => 
            `Title ${s.title} (shared with ${s.sharingAgencies.join(', ')})`
          ).join('; ')}`
        : '';
      
      return {
        agency: name,
        wordCount: data.wordCount,
        partsProcessed: data.completedParts,
        titles: agencyTitles,
        sharedRegulations: sharedWithOthers.length > 0,
        sharedRegulationsNote
      };
    }).sort((a, b) => b.wordCount - a.wordCount);
    
    await fs.writeFile(
      path.join(DATA_DIR, 'word_count_report.json'),
      JSON.stringify(finalReport, null, 2)
    );
    
    // Update status to completed
    progress.status = 'completed';
    progress.endTime = new Date().toISOString();
    await saveProgress();
    
    console.log(`Word count complete! Results saved to data/word-counts-small/word_count_report.json`);
    console.log(`Total elapsed time: ${Math.round((new Date() - new Date(progress.startTime)) / 1000 / 60)} minutes`);
  } catch (error) {
    console.error('Error running word count:', error);
    progress.status = 'error';
    progress.error = error.message;
    await saveProgress();
  }
}

// Export for command line use
module.exports = { runSmallestWordCount };

// Direct execution
if (require.main === module) {
  // Get number of agencies from command line, default to 5
  const topN = parseInt(process.argv[2]) || 5;
  console.log(`Starting word count for ${topN} smallest agencies...`);
  runSmallestWordCount(topN).catch(console.error);
} 
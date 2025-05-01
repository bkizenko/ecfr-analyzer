const express = require('express');
const path = require('path');
const axios = require('axios');
const NodeCache = require('node-cache');
const fs = require('fs').promises;

// Initialize express app
const app = express();
const PORT = process.env.PORT || 3000;

// Simple caching mechanism
const cache = new NodeCache({ stdTTL: 3600 }); // 1 hour cache

// Base URL for eCFR API
const ECFR_API_BASE = 'https://www.ecfr.gov/api';

// Create data directory if it doesn't exist
async function ensureDataDir() {
  try {
    await fs.mkdir(path.join(__dirname, '../data'), { recursive: true });
  } catch (err) {
    console.error('Error creating data directory:', err);
  }
}

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Create a simple HTML page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API Routes

// Get all agencies
app.get('/api/agencies', async (req, res) => {
  try {
    const cacheKey = 'agencies';
    const cachedData = cache.get(cacheKey);
    
    if (cachedData) {
      return res.json(cachedData);
    }
    
    const response = await axios.get(`${ECFR_API_BASE}/admin/v1/agencies.json`);
    cache.set(cacheKey, response.data);
    
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching agencies:', error.message);
    res.status(500).json({ error: 'Failed to fetch agencies' });
  }
});

// Get all titles
app.get('/api/titles', async (req, res) => {
  try {
    const cacheKey = 'titles';
    const cachedData = cache.get(cacheKey);
    
    if (cachedData) {
      return res.json(cachedData);
    }
    
    const response = await axios.get(`${ECFR_API_BASE}/versioner/v1/titles.json`);
    cache.set(cacheKey, response.data);
    
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching titles:', error.message);
    res.status(500).json({ error: 'Failed to fetch titles' });
  }
});

// Get title changes over time for a specific title
app.get('/api/analytics/title-changes/:title', async (req, res) => {
  try {
    const { title } = req.params;
    const cacheKey = `title-changes-${title}`;
    const cachedData = cache.get(cacheKey);
    
    if (cachedData) {
      return res.json(cachedData);
    }
    
    // Get versions for the title
    const currentYear = new Date().getFullYear();
    const startDate = `${currentYear-2}-01-01`; // Past 2 years

    const response = await axios.get(
      `${ECFR_API_BASE}/versioner/v1/versions/title-${title}.json?issue_date[gte]=${startDate}`
    );
    
    // Group changes by month
    const changesByMonth = {};
    response.data.content_versions.forEach(version => {
      const date = new Date(version.issue_date);
      const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      
      if (!changesByMonth[month]) {
        changesByMonth[month] = 0;
      }
      
      changesByMonth[month]++;
    });
    
    // Convert to array
    const changes = Object.entries(changesByMonth).map(([month, count]) => ({
      month,
      count
    })).sort((a, b) => a.month.localeCompare(b.month));
    
    const result = { changes };
    cache.set(cacheKey, result);
    res.json(result);
  } catch (error) {
    console.error(`Error fetching title changes for title ${req.params.title}:`, error.message);
    res.status(500).json({ error: `Failed to fetch title changes for title ${req.params.title}` });
  }
});

// Get word count by agency
app.get('/api/analytics/word-count', async (req, res) => {
  try {
    const cacheKey = 'word-count';
    const cachedData = cache.get(cacheKey);
    
    if (cachedData) {
      return res.json(cachedData);
    }
    
    // Get all agencies
    const agenciesResponse = await axios.get(`${ECFR_API_BASE}/admin/v1/agencies.json`);
    const agencies = agenciesResponse.data.agencies;
    
    // Initialize results
    const results = [];
    
    // Process first 5 agencies for demo purposes (reduce to avoid timeout)
    for (let i = 0; i < Math.min(5, agencies.length); i++) {
      const agency = agencies[i];
      let totalWords = 0;
      let totalSections = 0;
      let titles = [];
      
      // For each agency, we'll check their CFR references
      if (agency.cfr_references && agency.cfr_references.length > 0) {
        // Limit to first 2 CFR references per agency for demo
        for (let j = 0; j < Math.min(2, agency.cfr_references.length); j++) {
          const ref = agency.cfr_references[j];
          if (ref.title) {
            try {
              // Get the structure of the title
              const structureResponse = await axios.get(
                `${ECFR_API_BASE}/versioner/v1/structure/2023-01-01/title-${ref.title}.json`
              );
              
              titles.push(ref.title);
              
              // If the structure has parts, get a sample of sections to count words
              if (structureResponse.data.children && 
                  structureResponse.data.children.length > 0 &&
                  structureResponse.data.children[0].children) {
                
                // Get first 2 parts
                const parts = structureResponse.data.children[0].children.slice(0, 2);
                
                // For each part, get XML content to count actual regulation words
                for (const part of parts) {
                  try {
                    // Get XML content of the part
                    const partXml = await axios.get(
                      `${ECFR_API_BASE}/versioner/v1/full/2023-01-01/title-${ref.title}.xml?part=${part.identifier}`,
                      { responseType: 'text' }
                    );
                    
                    // Count words in the XML content
                    // Remove XML tags and count words
                    const textContent = partXml.data.replace(/<[^>]*>/g, ' ');
                    const words = textContent.split(/\s+/).filter(word => word.length > 0);
                    totalWords += words.length;
                    totalSections++;
                  } catch (err) {
                    console.log(`Error processing part ${part.identifier} for title ${ref.title}:`, err.message);
                  }
                }
              }
              
            } catch (err) {
              console.log(`Error processing title ${ref.title} for agency ${agency.name}:`, err.message);
            }
          }
        }
      }
      
      results.push({
        agency: agency.name,
        wordCount: totalWords,
        sectionsExamined: totalSections,
        titlesExamined: titles,
        measurementUnit: "words in regulatory text",
        note: "Sample count of words in actual regulatory text for selected parts"
      });
    }
    
    // Add metadata to the response
    const response = { 
      agencies: results,
      metadata: {
        measurement: "This count represents the number of words in the actual regulatory text associated with each agency",
        sampleSize: "Limited to examining a sample of titles and parts per agency for demonstration purposes",
        date: "2023-01-01"
      }
    };
    
    cache.set(cacheKey, response);
    res.json(response);
  } catch (error) {
    console.error('Error calculating word count:', error.message);
    res.status(500).json({ error: 'Failed to calculate word count' });
  }
});

// Get corrections over time
app.get('/api/analytics/corrections', async (req, res) => {
  try {
    const cacheKey = 'corrections';
    const cachedData = cache.get(cacheKey);
    
    if (cachedData) {
      return res.json(cachedData);
    }
    
    // Get corrections for the last few years
    const correctionResponse = await axios.get(
      `${ECFR_API_BASE}/admin/v1/corrections.json?date=2023-01-01`
    );
    
    const corrections = correctionResponse.data.ecfr_corrections;
    
    // Count corrections by year
    const correctionsByYear = {};
    
    corrections.forEach(correction => {
      const year = correction.error_corrected.split('-')[0];
      if (!correctionsByYear[year]) {
        correctionsByYear[year] = 0;
      }
      correctionsByYear[year]++;
    });
    
    // Convert to array format
    const results = Object.entries(correctionsByYear).map(([year, count]) => ({
      year,
      count
    }));
    
    cache.set(cacheKey, { corrections: results });
    res.json({ corrections: results });
  } catch (error) {
    console.error('Error calculating corrections:', error.message);
    res.status(500).json({ error: 'Failed to calculate corrections' });
  }
});

// Get complete word count results
app.get('/api/analytics/complete-word-count', async (req, res) => {
  try {
    const reportPath = path.join(__dirname, '../data/word-counts/word_count_report.json');
    
    try {
      const reportData = await fs.readFile(reportPath, 'utf8');
      const report = JSON.parse(reportData);
      
      res.json({
        agencies: report,
        metadata: {
          measurement: "Complete word count of regulatory text by agency",
          completedAt: new Date(await fs.stat(reportPath)).mtime.toISOString()
        }
      });
    } catch (err) {
      if (err.code === 'ENOENT') {
        // Report doesn't exist yet
        res.status(404).json({
          error: 'Complete word count report not available',
          message: 'Run the word count script first: node src/scripts/wordCountWithProgress.js'
        });
      } else {
        throw err;
      }
    }
  } catch (error) {
    console.error('Error retrieving complete word count:', error.message);
    res.status(500).json({ error: 'Failed to retrieve complete word count' });
  }
});

// Get word count progress
app.get('/api/analytics/word-count-progress', async (req, res) => {
  try {
    const progressPath = path.join(__dirname, '../data/word-counts/progress.json');
    
    try {
      const progressData = await fs.readFile(progressPath, 'utf8');
      const progress = JSON.parse(progressData);
      
      const formattedProgress = {
        status: progress.status,
        percentComplete: progress.totalAgencies > 0 
          ? Math.round((progress.completedAgencies / progress.totalAgencies) * 100) 
          : 0,
        currentAgency: progress.currentAgency,
        startTime: progress.startTime,
        lastUpdateTime: progress.lastSaveTime,
        totalAgencies: progress.totalAgencies,
        completedAgencies: progress.completedAgencies,
        elapsedMinutes: progress.startTime 
          ? Math.round((new Date() - new Date(progress.startTime)) / 1000 / 60) 
          : 0
      };
      
      res.json(formattedProgress);
    } catch (err) {
      if (err.code === 'ENOENT') {
        // Progress doesn't exist yet
        res.status(404).json({
          error: 'Word count has not been started',
          message: 'Run the word count script first: node src/scripts/wordCountWithProgress.js'
        });
      } else {
        throw err;
      }
    }
  } catch (error) {
    console.error('Error retrieving word count progress:', error.message);
    res.status(500).json({ error: 'Failed to retrieve word count progress' });
  }
});

// Serve the status.html file directly
app.get('/word-count-status', (req, res) => {
  res.sendFile(path.join(__dirname, '../data/word-counts/status.html'));
});

// Get small agencies word count results
app.get('/api/analytics/small-agencies-word-count', async (req, res) => {
  try {
    const reportPath = path.join(__dirname, '../data/word-counts-small/word_count_report.json');
    
    try {
      const reportData = await fs.readFile(reportPath, 'utf8');
      const report = JSON.parse(reportData);
      
      res.json({
        agencies: report,
        metadata: {
          measurement: "Word count of smallest agencies' regulatory text",
          description: "This data represents the regulatory text word count from the smallest agencies (by number of CFR references)",
          completedAt: new Date(await fs.stat(reportPath)).mtime.toISOString()
        }
      });
    } catch (err) {
      if (err.code === 'ENOENT') {
        // Report doesn't exist yet
        res.status(404).json({
          error: 'Small agencies word count report not available',
          message: 'Run the small agencies word count script first: node src/scripts/smallestWordCount.js'
        });
      } else {
        throw err;
      }
    }
  } catch (error) {
    console.error('Error retrieving small agencies word count:', error.message);
    res.status(500).json({ error: 'Failed to retrieve small agencies word count' });
  }
});

// Get small agencies word count progress
app.get('/api/analytics/small-agencies-progress', async (req, res) => {
  try {
    const progressPath = path.join(__dirname, '../data/word-counts-small/progress.json');
    
    try {
      const progressData = await fs.readFile(progressPath, 'utf8');
      const progress = JSON.parse(progressData);
      
      const formattedProgress = {
        status: progress.status,
        percentComplete: progress.totalAgencies > 0 
          ? Math.round((progress.completedAgencies / progress.totalAgencies) * 100) 
          : 0,
        currentAgency: progress.currentAgency,
        startTime: progress.startTime,
        lastUpdateTime: progress.lastSaveTime,
        totalAgencies: progress.totalAgencies,
        completedAgencies: progress.completedAgencies,
        elapsedMinutes: progress.startTime 
          ? Math.round((new Date() - new Date(progress.startTime)) / 1000 / 60) 
          : 0
      };
      
      res.json(formattedProgress);
    } catch (err) {
      if (err.code === 'ENOENT') {
        // Progress doesn't exist yet
        res.status(404).json({
          error: 'Small agencies word count has not been started',
          message: 'Run the small agencies word count script first: node src/scripts/smallestWordCount.js'
        });
      } else {
        throw err;
      }
    }
  } catch (error) {
    console.error('Error retrieving small agencies word count progress:', error.message);
    res.status(500).json({ error: 'Failed to retrieve small agencies word count progress' });
  }
});

// Serve the small agencies status.html file directly
app.get('/small-agencies-status', (req, res) => {
  res.sendFile(path.join(__dirname, '../data/word-counts-small/status.html'));
});

// Server initialization
async function startServer() {
  await ensureDataDir();
  
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Visit http://localhost:${PORT} to view the application`);
  });
}

startServer(); 
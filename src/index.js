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
    
    // Process first 10 agencies for demo purposes
    for (let i = 0; i < Math.min(10, agencies.length); i++) {
      const agency = agencies[i];
      let totalWords = 0;
      
      // For each agency, we'll check their CFR references
      if (agency.cfr_references && agency.cfr_references.length > 0) {
        for (const ref of agency.cfr_references) {
          // We'll just get the first part of the first title for this demo
          if (ref.title) {
            try {
              // Get the structure of the title
              const structureResponse = await axios.get(
                `${ECFR_API_BASE}/versioner/v1/structure/2023-01-01/title-${ref.title}.json`
              );
              
              // Count words in the title label
              const titleWords = structureResponse.data.label.split(/\s+/).length;
              totalWords += titleWords;
              
              // Sample the first part if available
              if (structureResponse.data.children && 
                  structureResponse.data.children.length > 0 &&
                  structureResponse.data.children[0].children &&
                  structureResponse.data.children[0].children.length > 0) {
                
                const firstPart = structureResponse.data.children[0].children[0];
                // Count words in the part label
                const partWords = firstPart.label.split(/\s+/).length;
                totalWords += partWords;
              }
              
              break; // Just do one title for demo
            } catch (err) {
              console.log(`Error processing title ${ref.title} for agency ${agency.name}:`, err.message);
            }
          }
        }
      }
      
      results.push({
        agency: agency.name,
        wordCount: totalWords
      });
    }
    
    cache.set(cacheKey, { agencies: results });
    res.json({ agencies: results });
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

// Server initialization
async function startServer() {
  await ensureDataDir();
  
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Visit http://localhost:${PORT} to view the application`);
  });
}

startServer(); 
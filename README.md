# eCFR Analyzer

A simple tool to analyze the Electronic Code of Federal Regulations (eCFR) data.

## Features

- Fetches data from the official eCFR API
- Analyzes word count by agency
- Tracks corrections over time
- Visualizes data using D3.js

## Getting Started

### Prerequisites

- Node.js (v14 or later)
- npm

### Installation

1. Clone this repository
```
git clone https://github.com/yourusername/ecfr-analyzer.git
cd ecfr-analyzer
```

2. Install dependencies
```
npm install
```

3. Start the server
```
npm start
```

4. Navigate to http://localhost:3000 to view the application

## API Endpoints

- `/api/agencies` - Get all agencies
- `/api/analytics/word-count` - Get approximate word count by agency (sample)
- `/api/analytics/corrections` - Get corrections over time

## Technologies Used

- Express.js - Web framework
- Axios - HTTP client
- D3.js - Data visualization
- Node-Cache - Caching mechanism

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- eCFR API - https://www.ecfr.gov/api 
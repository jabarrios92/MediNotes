const fs = require('fs');
fetch("http://localhost:3000/api/status/test").then(r => r.text()).then(console.log);

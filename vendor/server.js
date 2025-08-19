// Tiny static server for localhost usage
const express = require('express');
const app = express();
const port = process.env.PORT || 8080;
app.use((req,res,next)=>{ if (req.path.endsWith('.webmanifest')) res.type('application/manifest+json'); next(); });
app.use(express.static(__dirname, { extensions: ['html','js'] }));
app.listen(port, ()=>console.log('Running on http://localhost:'+port));

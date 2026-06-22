import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import documentRouter from './routes/documents';
import authRouter from './routes/auth';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

// Enable CORS for all routes (to support local React Vite dev server)
app.use(cors());

// Parse JSON request bodies
app.use(express.json());

// Register API Routes
app.use('/api/auth', authRouter);
app.use('/api/documents', documentRouter);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', service: 'Harvey API Gateway + Privacy Scrubber' });
});

app.listen(port, () => {
  console.log(`🚀 Harvey Express Server running on http://localhost:${port}`);
});

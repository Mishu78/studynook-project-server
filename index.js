const dns = require("node:dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]);

require('dotenv').config();
const cors = require('cors');
const { createRemoteJWKSet, jwtVerify } = require('jose-cjs');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const express = require('express');

const app = express();
const JWKS = createRemoteJWKSet(new URL(`${process.env.CLIENT_URL}/api/auth/jwks`));

app.use(cors({
  origin: process.env.CLIENT_URL || "http://localhost:3000",
  credentials: true // Crucial for Assignment rule 7.1 HTTP-Only cookies!
}));
app.use(express.json());

const port = process.env.PORT || 5000;
const uri = process.env.MONGODB_URI;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

const logger = (req, res, next) => {
  console.log(`${req.method} | ${req.url}`);
  next();
};

// ✅ FIX: Standardize user extraction so it works smoothly across all routes
const verifyToken = async (req, res, next) => {
  const { authorization } = req.headers;
  const token = authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Unauthorized: Missing token header.' });
  }

  try {
    const { payload } = await jwtVerify(token, JWKS);
    
    // Better Auth JWT plugin nests user parameters under payload.user
    req.user = {
      id: payload?.user?.id || payload?.id || payload?.sub,
      email: payload?.user?.email || payload?.email,
      name: payload?.user?.name || payload?.name
    };

    if (!req.user.email) {
      return res.status(401).json({ message: 'Unauthorized: Invalid token identity structure.' });
    }

    next();
  } catch (error) {
    console.error('Token validation failed:', error);
    return res.status(401).json({ message: 'Unauthorized: Token signature validation crashed.' });
  }
};

async function run() {
  try {
    await client.connect();
    const db = client.db("studynookdb");
    const roomsCollection = db.collection('rooms');
    const bookingCollection = db.collection('bookings');
    console.log("🚀 Database connected safely.");

    // ==========================================
    // POST /rooms (Create New Space)
    // ==========================================
    app.post('/rooms', verifyToken, async (req, res) => {
      try {
        const userEmail = req.user.email;
        const { roomName, description, image, floor, capacity, hourlyRate, amenities } = req.body;

        if (!roomName || !description || !floor || !capacity || !hourlyRate) {
          return res.status(400).json({ message: "Missing required configuration fields." });
        }

        const newRoom = {
          roomName,
          description,
          image: image || "https://images.unsplash.com/photo-1497366216548-37526070297c",
          floor,
          capacity: parseInt(capacity),
          hourlyRate: parseFloat(hourlyRate),
          amenities: Array.isArray(amenities) ? amenities : [],
          bookingCount: 0,
          lastBookedAt: null,
          createdBy: userEmail,
          createdAt: new Date()
        };

        const result = await roomsCollection.insertOne(newRoom);
        res.status(201).json({ message: "Sanctuary created successfully!", result });
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to create room." });
      }
    });

    // ==========================================
// GET /rooms (Catalog Search, Filtering & Ownership)
// ==========================================
app.get("/rooms", async (req, res) => {
  try {
    const { search, amenities, minPrice, maxPrice, createdBy } = req.query;
    let query = {};

    // 🎯 NEW: Filter strictly by the creator's email if provided
    if (createdBy && createdBy.trim() !== "") {
      query.createdBy = createdBy;
    }

    // Only run search regex if 'search' actually contains text characters
    if (search && search.trim() !== "") {
      query.$or = [
        { roomName: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { instructor: { $regex: search, $options: 'i' } } 
      ];
    }

    if (amenities && amenities.trim() !== "") {
      const amenitiesList = amenities.split(',');
      query.amenities = { $all: amenitiesList };
    }

    if (minPrice || maxPrice) {
      query.hourlyRate = {};
      if (minPrice && minPrice.trim() !== "") query.hourlyRate.$gte = Number(minPrice);
      if (maxPrice && maxPrice.trim() !== "") query.hourlyRate.$lte = Number(maxPrice);
      
      if (Object.keys(query.hourlyRate).length === 0) {
        delete query.hourlyRate;
      }
    }

    console.log("🔍 Final MongoDB operational query object:", JSON.stringify(query));

    const result = await roomsCollection.find(query).toArray();
    res.send(result);
  } catch (err) {
    console.error("Error executing advanced room queries:", err);
    res.status(500).send({ error: "Failed to fetch room catalog." });
  }
});
    // ==========================================
    // POST /bookings (Handle Booking with Collision Avoidance)
    // ==========================================
    // ✅ FIX: Aligned with the front-end fetch pathway: `${baseUrl}/bookings`
    app.post('/bookings', verifyToken, async (req, res) => {
      try {
        const { roomId, date, startTime = "09:00", endTime = "17:00", specialNote } = req.body;

        if (!roomId || !date) {
          return res.status(400).json({ message: "Missing required booking date metrics." });
        }

        const targetRoomId = new ObjectId(roomId);
        const room = await roomsCollection.findOne({ _id: targetRoomId });
        if (!room) return res.status(404).json({ message: "Room target not found." });

        // Convert string times to numeric hours for comparison (e.g., "09:00" -> 9)
        const startHour = parseInt(startTime.split(':')[0]);
        const endHour = parseInt(endTime.split(':')[0]);

        if (endHour <= startHour) {
          return res.status(400).json({ message: "End time must be after start time slot." });
        }

        // 🚨 REQUIREMENT 5.1 & 7.3: Booking conflict check using overlapping math logic
        const existingConflict = await bookingCollection.findOne({
          roomId: roomId,
          date: date,
          status: "confirmed",
          $or: [
            {
              startTime: { $lt: endTime },
              endTime: { $gt: startTime }
            }
          ]
        });

        if (existingConflict) {
          return res.status(409).json({ message: "Time slot conflict detected. This room is already reserved." });
        }

        const totalCost = (endHour - startHour) * (room.hourlyRate || 0);

        const newBooking = {
          roomId,
          roomName: room.roomName,
          image: room.image,
          date,
          startTime,
          endTime,
          totalCost,
          specialNote: specialNote || "",
          userId: req.user.id,
          userEmail: req.user.email,
          userName: req.user.name,
          status: "confirmed",
          bookedAt: new Date()
        };

        const result = await bookingCollection.insertOne(newBooking);

        await roomsCollection.updateOne(
          { _id: targetRoomId },
          {
            $inc: { bookingCount: 1 },
            $set: { lastBookedAt: new Date() }
          }
        );

        res.status(201).json({ message: "Booking verified!", insertedId: result.insertedId });
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed allocation." });
      }
    });

    // ==========================================
    // GET /bookings/user/:userId
    // ==========================================
    app.get('/bookings/user/:userId', verifyToken, async (req, res) => {
      try {
        const { userId } = req.params;
        const result = await bookingCollection.find({ userId: userId }).toArray();
        res.send(result);
      } catch (err) {
        res.status(500).json({ error: "Failed to parse records." });
      }
    });

    // ==========================================
    // PATCH /bookings/:id/cancel
    // ==========================================
    app.patch('/bookings/:id/cancel', verifyToken, async (req, res) => {
      try {
        const { id } = req.params;
        const bookingQuery = { _id: new ObjectId(id) };

        const booking = await bookingCollection.findOne(bookingQuery);
        if (!booking) return res.status(404).json({ message: "Booking not found." });

        await bookingCollection.updateOne(bookingQuery, { $set: { status: "cancelled" } });

        if (booking.roomId) {
          await roomsCollection.updateOne(
            { _id: new ObjectId(booking.roomId) },
            { $inc: { bookingCount: -1 } }
          );
        }

        res.send({ message: "Booking cancelled successfully" });
      } catch (err) {
        res.status(500).json({ error: "Failed processing cancellation tasks." });
      }
    });


    // ==========================================
    // PUT /rooms/:roomId (Update Room - Owner Only)
    // ==========================================
    app.put("/rooms/:roomId", verifyToken, async (req, res) => {
      try {
        const { roomId } = req.params;
        const userEmail = req.user.email; // Extracted safely from verifyToken

        // Find the room to check ownership parameters
        const existingRoom = await roomsCollection.findOne({ _id: new ObjectId(roomId) });
        if (!existingRoom) {
          return res.status(404).json({ message: "Workspace sanctuary room not found." });
        }

        // 🚨 Assignment Rule Check: Match logged-in user with listing creator
        if (existingRoom.createdBy !== userEmail) {
          return res.status(403).json({ message: "Forbidden: You are not authorized to modify this space." });
        }

        const { roomName, description, image, floor, capacity, hourlyRate, amenities } = req.body;

        const updatedRoom = {
          $set: {
            roomName: roomName || existingRoom.roomName,
            description: description || existingRoom.description,
            image: image || existingRoom.image,
            floor: floor || existingRoom.floor,
            capacity: capacity ? parseInt(capacity) : existingRoom.capacity,
            hourlyRate: hourlyRate ? parseFloat(hourlyRate) : existingRoom.hourlyRate,
            amenities: Array.isArray(amenities) ? amenities : existingRoom.amenities,
            updatedAt: new Date()
          }
        };

        await roomsCollection.updateOne({ _id: new ObjectId(roomId) }, updatedRoom);
        res.status(200).json({ message: "Room updated successfully." });
      } catch (err) {
        console.error("PUT /rooms/:roomId operational crash:", err);
        res.status(500).json({ error: "Failed to update target room dataset parameters." });
      }
    });

    // ==========================================
    // DELETE /rooms/:roomId (Delete Room - Owner Only)
    // ==========================================
    app.delete("/rooms/:roomId", verifyToken, async (req, res) => {
      try {
        const { roomId } = req.params;
        const userEmail = req.user.email; // Extracted safely from verifyToken

        // Find the room to check ownership parameters
        const existingRoom = await roomsCollection.findOne({ _id: new ObjectId(roomId) });
        if (!existingRoom) {
          return res.status(404).json({ message: "Workspace sanctuary room not found." });
        }

        // 🚨 Assignment Rule Check: Match logged-in user with listing creator
        if (existingRoom.createdBy !== userEmail) {
          return res.status(403).json({ message: "Forbidden: You are not authorized to delete this space." });
        }

        // Clean up linked artifacts: Wipe out all bookings referencing this room structure
        await bookingCollection.deleteMany({ roomId: roomId });
        
        // Erase the room document
        await roomsCollection.deleteOne({ _id: new ObjectId(roomId) });

        res.status(200).json({ message: "Room deleted successfully." });
      } catch (err) {
        console.error("DELETE /rooms/:roomId operational crash:", err);
        res.status(500).json({ error: "Failed to erase target room listing parameters." });
      }
    });

    app.get('/', (req, res) => {
      res.send('StudyNook Server is Running Running!')
    });

    app.listen(port, () => {
      console.log(`🚀 StudyNook backend listening smoothly on port ${port}`);
    });

  } catch (error) {
    console.error("Database connection failure:", error);
  }
}

run().catch(console.dir);
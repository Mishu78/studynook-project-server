const dns = require("node:dns");

dns.setServers(["8.8.8.8", "8.8.4.4"]);



require('dotenv').config();

const cors = require('cors');

const { createRemoteJWKSet, jwtVerify } = require('jose-cjs');

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const express = require('express');

const app = express();



app.use(cors());

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

const JWKS = createRemoteJWKSet(new URL(`${process.env.CLIENT_URL}/api/auth/jwks`));

const logger = (req, res, next) => {

  console.log(`${req.method} | ${req.url}`);

  next();

};


const verifyToken = async (req, res, next) => {

  const { authorization } = req.headers;

  const token = authorization?.split(' ')[1];


  if (!token) {

    return res.status(401).json({ message: 'Unauthorize' });

  }


  try {

    const dynamicJWKS = createRemoteJWKSet(new URL(`${process.env.CLIENT_URL}/api/auth/jwks`));

    const { payload } = await jwtVerify(token, dynamicJWKS);

    req.user = payload;



    next();

  } catch (error) {

    console.error('Token validation failed:', error);

    return res.status(401).json({ message: 'Unauthorize' });

  }

};


async function run() {

  try {

    await client.connect();

    const db = client.db("studynookdb");

    const roomsCollection = db.collection('rooms');

    const bookingCollection = db.collection('bookings');

    console.log("Database connected. Hooking up endpoints...");

 // ==========================================
// POST /rooms (Create New Study Sanctuary Room)
// ==========================================
app.post('/rooms', verifyToken, async (req, res) => {
  try {
    // Better Auth payloads put the user's details inside req.user.user
    const userEmail = req.user?.user?.email || req.user?.email;

    if (!userEmail || userEmail === "anonymous") {
      return res.status(401).json({ message: "Unauthorized: Missing valid user identity profile context." });
    }

    const { roomName, description, image, floor, capacity, hourlyRate, amenities } = req.body;

    if (!roomName || !description || !floor || !capacity || !hourlyRate) {
      return res.status(400).json({ message: "Missing required room configuration metrics." });
    }

    const newRoom = {
      roomName,
      description,
      image: image || "https://images.unsplash.com/photo-1497366216548-37526070297c", // Fallback placeholder
      floor,
      capacity: parseInt(capacity),
      hourlyRate: parseFloat(hourlyRate),
      amenities: Array.isArray(amenities) ? amenities : [],
      bookingCount: 0,
      lastBookedAt: null,
      createdBy: userEmail, // Safely bound to the authenticated creator's email
      createdAt: new Date()
    };

    const result = await roomsCollection.insertOne(newRoom);
    
    // Return a success status along with the result object
    res.status(201).json({ message: "Sanctuary created successfully!", result });
  } catch (err) {
    console.error("Error creating new study room:", err);
    res.status(500).json({ error: "Failed to create premium room sanctuary listing." });
  }
});


   // ==========================================
    // GET /rooms (Advanced Search & Filtering Catalog)
    // ==========================================
    app.get("/rooms", async (req, res) => {
      try {
        const { search, amenities, minPrice, maxPrice } = req.query;
        let query = {};

        // 1. Regex Search by name or instructor
        if (search) {
          query.$or = [
            { roomName: { $regex: search, $options: 'i' } },
            { instructor: { $regex: search, $options: 'i' } },
          ];
        }

        // 2. Filter by multiple amenities using array match ($all handles multiple checked constraints)
        if (amenities) {
          const amenitiesList = amenities.split(',');
          query.amenities = { $all: amenitiesList };
        }

        // 3. Filter by Range Matrix Operators ($gte, $lte)
        if (minPrice || maxPrice) {
          query.hourlyRate = {};
          if (minPrice) query.hourlyRate.$gte = Number(minPrice);
          if (maxPrice) query.hourlyRate.$lte = Number(maxPrice);
        }

        const cursor = roomsCollection.find(query);
        const result = await cursor.toArray();
        res.send(result);
      } catch (err) {
        console.error("Error executing advanced room queries:", err);
        res.status(500).send({ error: "Failed to fetch rooms filtered catalog" });
      }
    });

    

    // Featured Rooms Endpoint

    app.get("/featured", async (req, res) => {

      try {

        const cursor = roomsCollection.find().sort({ _id: -1 }).limit(6);

        const result = await cursor.toArray();

        res.send(result);

      } catch (err) {

        res.status(500).send({ error: "Failed to fetch featured rooms" });

      }

    });



// Single Room Details Endpoint



    app.get("/rooms/:roomId", logger, verifyToken, async (req, res) => {



      try {



        const { roomId } = req.params;



        const query = { _id: new ObjectId(roomId) };



        const result = await roomsCollection.findOne(query);



        res.send(result);



      } catch (err) {



        res.status(500).send({ error: "Failed to fetch room details" });



      }



    });

 
// 2. PUT /rooms/:roomId (Update Room - Owner Only)
// ==========================================
app.put("/rooms/:roomId", verifyToken, async (req, res) => {
  try {
    const { roomId } = req.params;
    const userEmail = req.user?.email;

    const existingRoom = await roomsCollection.findOne({ _id: new ObjectId(roomId) });
    if (!existingRoom) {
      return res.status(404).json({ message: "Room sanctuary not found." });
    }

    if (existingRoom.createdBy !== userEmail) {
      return res.status(403).json({ message: "Forbidden: You do not own this listing." });
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

    const result = await roomsCollection.updateOne({ _id: new ObjectId(roomId) }, updatedRoom);
    res.status(200).json({ message: "Room updated successfully", result });
  } catch (err) {
    res.status(500).json({ error: "Failed to update your sanctuary room listing." });
  }
});

// ==========================================
// 3. DELETE /rooms/:roomId (Delete Room - Owner Only)
// ==========================================
app.delete("/rooms/:roomId", verifyToken, async (req, res) => {
  try {
    const { roomId } = req.params;
    const userEmail = req.user?.email;

    const existingRoom = await roomsCollection.findOne({ _id: new ObjectId(roomId) });
    if (!existingRoom) {
      return res.status(404).json({ message: "Room sanctuary not found." });
    }

    if (existingRoom.createdBy !== userEmail) {
      return res.status(403).json({ message: "Forbidden: Ownership verification failed." });
    }

    // Clean up dependencies
    await bookingCollection.deleteMany({ roomId: roomId });

    const result = await roomsCollection.deleteOne({ _id: new ObjectId(roomId) });
    res.status(200).json({ message: "Room deleted successfully", result });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete room sanctuary entry." });
  }
});


    // ✅ FIXED: Handle Booking Processing and Room Statistics Patch Updates

    app.patch('/bookings/:roomId', verifyToken, async (req, res) => {

      try {

        const { roomId } = req.params;

        const bookingData = req.body;

      

        const room = await roomsCollection.findOne({ _id: new ObjectId(roomId) });



        if (!room) {

          return res.status(404).json({ message: 'room not found' }); // Added explicit return

        }



        await roomsCollection.updateOne(

          { _id: new ObjectId(roomId) },

          {

            $inc: { bookingCount: 1 },

            $set: { lastBookedAt: new Date() }

          }

        );



        const result = await bookingCollection.insertOne({

          ...bookingData,

          bookedAt: new Date(), // Fixed typo from 'new Data()'

        });



        res.send(result);

      } catch (err) {

        console.error("Error patching booking details:", err);

        res.status(500).send({ error: "Failed to handle booking step" });

      }

    }); // Added missing closing curly brace and parenthesis here!



    // ==========================================

// 5.1 POST /api/bookings (Create with Conflict Validation)

// ==========================================

app.post('/api/bookings', verifyToken, async (req, res) => {

  try {

    const { roomId, date, startTime, endTime, hourlyRate, specialNote, userEmail, userName, userId, roomName, image } = req.body;



    if (!roomId || !date || !startTime || !endTime) {

      return res.status(400).json({ message: "Missing required booking details." });

    }



    const targetRoomId = new ObjectId(roomId);

    const room = await roomsCollection.findOne({ _id: targetRoomId });

    if (!room) {

      return res.status(404).json({ message: "Requested room sanctuary does not exist." });

    }



    // Conflict Check Constraint Logic

   // ✅ FIXED: Using direct overlapping boundaries with $and logic blocks
    const existingConflict = await bookingCollection.findOne({
      roomId: roomId,
      date: date,
      status: "confirmed",
      $and: [
        { startTime: { $lt: endTime } },
        { endTime: { $gt: startTime } }
      ]
    });

    if (existingConflict) {
      return res.status(409).json({ message: "Time slot conflict detected. This period is already reserved." });
    }



    // Compute cost server side to avoid client tampering values

    const hours = parseInt(endTime.split(":")[0]) - parseInt(startTime.split(":")[0]);

    const totalCost = hours * (room.hourlyRate || hourlyRate || 0);



    const newBooking = {

      roomId,

      roomName: room.roomName || roomName,

      image: room.image || image,

      date,

      startTime,

      endTime,

      totalCost,

      specialNote: specialNote || "",

      userId: userId || req.user?.id,

      userEmail: userEmail || req.user?.email,

      userName: userName || req.user?.name,

      status: "confirmed",

      bookedAt: new Date()

    };



    const result = await bookingCollection.insertOne(newBooking);



    // Increment overall historical booking volume for room metadata

    await roomsCollection.updateOne(

      { _id: targetRoomId },

      { 

        $inc: { bookingCount: 1 },

        $set: { lastBookedAt: new Date() }

      }

    );



    res.status(201).send({ insertedId: result.insertedId, totalCost });

  } catch (err) {

    console.error("Booking error:", err);

    res.status(500).json({ error: "Failed to allocate room reservation." });

  }

});



// ==========================================

// 5.2 GET /api/bookings/:userId (User Reservations Index)

// ==========================================

app.get('/bookings/user/:userId', verifyToken, async (req, res) => {

  // Alias or fallback route mapping to bookings collection collection directly

  try {

    const { userId } = req.params;

    const result = await bookingCollection.find({ userId: userId }).toArray();

    res.send(result);

  } catch (err) {

    res.status(500).json({ error: "Failed to parse user dashboard booking ledger records." });

  }

});



// Explicit bookings query route for client consistency

app.get('/api/bookings/user/:userId', verifyToken, async (req, res) => {

  try {

    const { userId } = req.params;

    const result = await bookingCollection.find({ userId: userId }).toArray();

    res.send(result);

  } catch (err) {

    res.status(500).json({ error: "Failed to parse user bookings." });

  }

});



// ==========================================

// 5.3 PATCH /api/bookings/:id/cancel (Revocation Operations)

// ==========================================

app.patch('/api/bookings/:id/cancel', verifyToken, async (req, res) => {

  try {

    const { id } = req.params;

    const bookingQuery = { _id: new ObjectId(id) };



    const booking = await bookingCollection.findOne(bookingQuery);

    if (!booking) {

      return res.status(404).json({ message: "Target booking document not found." });

    }



    // Update operational active reservation flags inside collection database index

    const updateResult = await bookingCollection.updateOne(

      bookingQuery,

      { $set: { status: "cancelled" } }

    );



    // Optional structure decrement balancing room logs counter index metrics

    if (booking.roomId) {

      await roomsCollection.updateOne(

        { _id: new ObjectId(booking.roomId) },

        { $inc: { bookingCount: -1 } }

      );

    }



    res.send({ message: "Booking cancelled successfully", modifiedCount: updateResult.modifiedCount });

  } catch (err) {

    console.error("Cancellation routing validation errors:", err);

    res.status(500).json({ error: "Failed processing cancellation tasks." });

  }

});

    // Root server diagnostic string endpoint

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
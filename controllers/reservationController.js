const Reservation = require('../models/Reservation');
const Flight = require('../models/Flight');
const User = require('../models/User');
const { generateUniquePNR } = require('../utils/utils');

const PREMIUM_ROWS = new Set([1, 2, 3, 4]);

// --- 1. GET Booking Form ---
exports.getBookingForm = async(req, res) => {
    try {
        const flight = await Flight.findOne({ flightNumber: req.params.flightNumber }).lean();
        if (!flight) {
            return res.status(404).send('Flight not found');
        }

        const activeReservations = await Reservation.find({
            flightId: flight._id,
            status: { $ne: 'cancelled' }
        }).select('seat.code');

        const occupiedSeats = activeReservations.map(r => r.seat.code);

        res.render('reservations/reservation', {
            flight: flight,
            pageTitle: 'Book Flight',
            occupiedSeats: JSON.stringify(occupiedSeats)
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

// --- 2. POST Create Reservation ---
// --- 2. POST Create Reservation ---
exports.createReservation = async (req, res) => {
  try {
    const { firstName, lastName, email, passport, seat, mealOption, baggage, flightId } = req.body;
    const userId = req.session.userId || null; 

    if (!firstName || !lastName || !email || !passport || !seat || !flightId) {
      return res.status(400).json({ message: 'Missing required fields.' });
    }

    const flight = await Flight.findById(flightId);
    if (!flight) {
      return res.status(404).json({ message: 'Flight not found.' });
    }

    const existingReservation = await Reservation.findOne({
      flightId,
      'seat.code': seat,
      status: { $ne: 'cancelled' }
    });

    if (existingReservation) {
      return res.status(400).json({ message: `Seat ${seat} is already booked. Please choose another.` });
    }

    const pnr = await generateUniquePNR();
    const seatMatch = (typeof seat === 'string') ? seat.match(/^\d+/) : null;
    const seatRow = parseInt(seatMatch ? seatMatch[0] : '0', 10);
    const isPremiumSeat = PREMIUM_ROWS.has(seatRow);
    const mealLabel = (mealOption && mealOption.label) ? mealOption.label : 'None';
    const mealPrice = (mealOption && mealOption.price) ? Number(mealOption.price) : 0;

    const newReservation = new Reservation({
      flightId,
      userId,
      firstName,
      lastName,
      email,
      passport,
      seat: { code: seat, isPremium: isPremiumSeat },
      meal: { label: mealLabel, price: mealPrice },
      baggage: { kg: parseInt(baggage, 10) || 0 },
      bill: { baseFare: flight.price },
      pnr
    });

    const savedReservation = await newReservation.save(); // Variable was missing
    res.status(201).json(savedReservation); // Now uses the correct variable

  } catch (err) { // Renamed the error variable to 'err' for consistency
    console.error('Reservation creation error:', err);
    // Use the error variable from the catch block
    res.status(500).json({ message: 'Server error', error: err.message }); 
  }
};

// --- 3. GET Edit Form ---
exports.getEditForm = async(req, res) => {
    try {
        const reservation = await Reservation.findById(req.params.id).populate('flightId').lean();
        if (!reservation) {
            return res.status(404).send('Reservation not found');
        }

        const otherReservations = await Reservation.find({
            flightId: reservation.flightId._id,
            status: { $ne: 'cancelled' },
            _id: { $ne: reservation._id }
        }).select('seat.code');

        const occupiedSeats = otherReservations.map(r => r.seat.code);

        res.render('reservations/reservation-edit', {
            reservation,
            pageTitle: 'Edit Booking',
            occupiedSeats: JSON.stringify(occupiedSeats)
        });

    } catch (err) {
        console.error(err);
        res.status(500).send('Error loading edit page');
    }
};

// --- 4. PUT Update Reservation ---
exports.updateReservation = async(req, res) => {
    try {
        const { id } = req.params;
        const { seat, mealOption, baggage } = req.body;

        const reservation = await Reservation.findById(id);
        if (!reservation) {
            return res.status(404).json({
                success: false,
                message: 'Reservation not found'
            });
        }

        let existingReservation = null;
        if (seat && seat !== reservation.seat.code) {
            existingReservation = await Reservation.findOne({
                flightId: reservation.flightId,
                'seat.code': seat,
                status: { $ne: 'cancelled' },
                _id: { $ne: id }
            });

            if (existingReservation) {
                return res.status(400).json({
                    success: false,
                    message: `Seat ${seat} is already booked. Please choose another.`
                });
            }
        }

        const oldTotal = reservation.bill.total; 

        if (seat) {
            const seatMatch = (typeof seat === 'string') ? seat.match(/^\d+/) : null;
            const seatRow = parseInt(seatMatch ? seatMatch[0] : '0', 10);
            reservation.seat.code = seat;
            reservation.seat.isPremium = PREMIUM_ROWS.has(seatRow);
        }
        if (mealOption) {
            reservation.meal.label = (mealOption && mealOption.label) ? mealOption.label : 'None';
            reservation.meal.price = (mealOption && mealOption.price) ? Number(mealOption.price) : 0;
        }
        if (baggage !== undefined) {
            reservation.baggage.kg = parseInt(baggage, 10) || 0;
        }

        const updatedReservation = await reservation.save();
        const newTotal = updatedReservation.bill.total;
        const amountDue = Math.max(0, newTotal - oldTotal);

        return res.json({
            success: true,
            updatedReservation,
            amountDue: amountDue
        });

    } catch (err) { 
        console.error('Reservation update error:', err);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: err.message
        });
    }
};

// --- 5. GET List Reservations ---
exports.getAllReservations = async(req, res) => {
    try {
        const userId = req.session.userId;

        if (!userId) {
            return res.redirect('/login');
        }

        const reservations = await Reservation.find({userId}).populate('flightId').lean();

        res.render('reservations/reservation-list', { reservations });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error fetching reservations');
    }
};

// --- 6. GET Admin User Reservations ---
exports.getUserReservationsAdmin = async(req, res) => {
    try {
        const userId = req.session.userId
        const reservations = await Reservation.find({ userId: userId }).populate('flightId').lean();
        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).send('User not found');
        }

        res.render('userReservations', {
            title: `${user.fullName}'s Reservations`,
            reservations,
            user
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
};

// --- 7. GET Reservation Details ---
exports.getReservationDetails = async(req, res) => {
    try {
        const reservation = await Reservation.findById(req.params.id).populate('flightId').lean();
        if (reservation) {
            const userId = req.session.userId;
            if(!userId || !reservation.userId || reservation.userId.toString() !== userId.toString()){
                return res.status(403).send('Access unauthorized')
            }

            res.render('reservations/reservation-details', { reservation });
        } else {
            return res.status(404).send('Reservation not found');
        }
    } catch (err) {
        console.error(err);
        res.status(500).send('Error fetching reservation details');
    }
};

// --- 8. POST Cancel Reservation ---
exports.cancelReservation = async(req, res) => {
    try {
        await Reservation.findByIdAndUpdate(req.params.id, { status: 'cancelled' });

        const userId = req.session.userId;
        if (userId) {
            return res.redirect(`/reservations?userId=${userId}`);
        }
        res.redirect('/reservations');
    } catch (err) {
        console.error(err);
        res.status(500).send('Error cancelling reservation');
    }
};

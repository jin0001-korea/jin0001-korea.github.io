// Start-time choices. Stored/source times remain exact until staff changes them.
export const BOOKING_START_TIMES=Object.freeze(Array.from({length:97},(_,index)=>{
 const minutes=7*60+index*10;
 return `${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;
}));
export const isBookingStartTime=value=>BOOKING_START_TIMES.includes(value);

const twilio = require('twilio');
const moment = require('moment');
const axios = require('axios');
const notifier = require('node-notifier')
// const accountSid = process.env.TWILIO_ACCOUNT_SID;
// const authToken = process.env.TWILIO_AUTH_TOKEN;

// const client = new twilio(accountSid, authToken);
const winston = require('winston');

const rivers = require('./rivers.json');

const logger = winston.createLogger({
	level: 'info',
	format: winston.format.json(),
	defaultMeta: { service: 'user-service' },
	transports: [
	  //
	  // - Write all logs with importance level of `error` or less to `error.log`
	  // - Write all logs with importance level of `info` or less to `combined.log`
	  //
	  new winston.transports.File({ filename: 'error.log', level: 'error' }),
	  new winston.transports.File({ filename: 'combined.log' }),
	  new winston.transports.Console({
		format: winston.format.simple(),
	  }),
	],
});

class RiverFinder {
	constructor(name, id, startDate, endDate) {
		this.name = name;
		this.id = id;
        this.startDate = startDate;
		this.startOfMonth = moment(new Date(startDate)).startOf('month').format('YYYY-MM-DD');
		this.endDate = endDate;
    }

	get url() {
		return `https://www.recreation.gov/api/permits/${this.id}/availability/month?start_date=${this.startOfMonth}T00:00:00.000Z&commercial_acct=false&is_lottery=false`
	}

	get link() {
		return `https://www.recreation.gov/permits/${this.id}/registration/detailed-availability`
	}

	getAvailability() {
		return axios.get(this.url)
	}

	async getResults() {

		logger.info(`Checking ${this.name} river for available dates between ${this.startDate} and ${this.endDate}`)

		const { data } = await this.getAvailability();

		return this.parseResults(data);
	}

	parseResults(data) {
		const { availability, next_available_date } = data.payload;
		const availableDates = Object.entries(availability).map(([id, available]) => available.date_availability)

		const startDate = moment(new Date(this.startDate));
		const endDate = moment(new Date(this.endDate));
		
		const matchingDates = availableDates.map((item) => {
			const dates = Object.keys(item);

			const _matchingDates = dates.filter((date) => {
				return moment(new Date(date)).isBetween(startDate, endDate) && item[date].remaining > 0
			});

			return _matchingDates.map((date) => {
				return {
					date,
					available: item[date]
				}
			})
			
		});

		return matchingDates;
	}
}

class Notification {
	constructor(name, availableDates, link) {
		this.name = name;
		this.availableDates = availableDates;
		this.link = link;
	}

	get message() {

		const dates = this.availableDates.map((item) => item.date).join(', ');

		return `${this.name} has available dates: ${dates}: link: ${this.link}`
	}

	send() {
		notifier.notify({
			title: 'Available Dates',
			message: this.message,
			sound: true,
		});
		logger.info(this.message);
	}
}


class Program {
	constructor() {
		this.rivers = [];
		this.currentRiver = null;
		this.pointer = 0;
		this.maxTimeoutMinutes = 15;
		this.minTimeoutMinutes = 5;
		this.sendNotificationsTo = [];
	}

	get timeoutTiming() {
		let time = 1000 * 60 * Math.random() * this.maxTimeoutMinutes;

		if(time < this.minTimeoutInMiliseconds) {
			time += this.minTimeoutInMiliseconds;
		}

		return Math.round(time)
	}

	get minTimeoutInMiliseconds() {
		return this.minTimeoutMinutes * 60 * 1000;
	}

	isRivers() {
		return !!this.rivers.length
	}

	initialize(rivers) {


		this.rivers = rivers.map((river) => new RiverFinder(river.name, river.id, river.startDate, river.endDate));

		if(this.isRivers()) {
			this.getRiver();
			this.getRiverData();
		}
	}

	getRiver() {
		this.currentRiver = this.rivers[this.pointer];
	}

	getNextRiver() {
		if(this.pointer < this.rivers.length - 1) {
			this.pointer += 1;
		} else {
			this.pointer = 0;
		}

		this.getRiver();
	}

	async getRiverData() {
		console.log('currentRiver', this.currentRiver)
		const results = await this.currentRiver.getResults();

		const availableDates = results.filter((item) => item.length);

		if(availableDates.length) {
			logger.info(`Found available dates for ${this.currentRiver.name} river`);
			const notification = new Notification(this.currentRiver.name, availableDates, this.currentRiver.link);

			await notification.send();
			logger.info(`Sent notification for ${this.currentRiver.name} river`);
		}

		this.getNextRiver();
		await this.timeout();

		this.getRiverData();
	}

	timeout() {
		return new Promise((resolve) => {
			setTimeout(() => {
				resolve();
			}, this.timeoutTiming)
		})
	}

	async run() {

	}
}


const program = this.program = new Program();

program.initialize(rivers);


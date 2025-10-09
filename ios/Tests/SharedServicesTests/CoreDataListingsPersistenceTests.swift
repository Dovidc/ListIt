import XCTest
@testable import SharedServices

final class CoreDataListingsPersistenceTests: XCTestCase {
    func testStoresAndLoadsListings() throws {
        let stack = try CoreDataStack(inMemory: true)
        let persistence = CoreDataListingsPersistence(stack: stack)
        let url = URL(string: "https://example.com/cover.jpg")
        let avatar = URL(string: "https://example.com/avatar.png")
        let created = Date(timeIntervalSince1970: 1_700_000_000)
        let listings = [
            ListingSummary(
                id: "1",
                title: "One",
                subtitle: "First",
                priceText: "$25",
                price: 25,
                location: "Seattle, WA",
                description: "A great item",
                tags: ["furniture", "handmade"],
                coverImageURL: url,
                galleryImages: [],
                sellerName: "Morgan",
                sellerAvatarURL: avatar,
                createdAt: created,
                isFavorite: true,
                isBoosted: false,
                isSold: true,
                distanceText: "3 mi",
                distanceMeters: 4828
            )
        ]

        try persistence.store(listings: listings)
        let cached = try persistence.loadListings()
        XCTAssertEqual(cached.count, 1)
        guard let first = cached.first else { return XCTFail("Missing cached listing") }
        XCTAssertEqual(first.id, "1")
        XCTAssertEqual(first.title, "One")
        XCTAssertEqual(first.subtitle, "First")
        XCTAssertEqual(first.priceText, "$25")
        XCTAssertEqual(first.price, 25)
        XCTAssertEqual(first.location, "Seattle, WA")
        XCTAssertEqual(first.description, "A great item")
        XCTAssertEqual(first.tags, ["furniture", "handmade"])
        XCTAssertEqual(first.coverImageURL, url)
        XCTAssertEqual(first.sellerName, "Morgan")
        XCTAssertEqual(first.sellerAvatarURL, avatar)
        XCTAssertEqual(first.createdAt, created)
        XCTAssertTrue(first.isFavorite)
        XCTAssertTrue(first.isSold)
        XCTAssertEqual(first.distanceText, "3 mi")
        XCTAssertEqual(first.distanceMeters, 4828)
    }

    func testClearRemovesListings() throws {
        let stack = try CoreDataStack(inMemory: true)
        let persistence = CoreDataListingsPersistence(stack: stack)
        try persistence.store(listings: [ListingSummary(id: "1", title: "One", subtitle: "")])
        try persistence.clear()
        let cached = try persistence.loadListings()
        XCTAssertTrue(cached.isEmpty)
    }
}
